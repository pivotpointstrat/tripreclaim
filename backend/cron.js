/**
 * TripReclaim — Price Monitoring Cron Job
 *
 * Run this as a separate process on Railway (or as a scheduled job).
 * It wakes up every 15 minutes, checks which bookings are due,
 * and runs the monitoring cycle.
 *
 * Additional scheduled tasks:
 *  - Daily 9am UTC:  Credit expiry reminders (30-day and 7-day warnings)
 *  - Monday 3am UTC: Weekly airline policy refresh via Firecrawl
 *
 * Deploy command: node cron.js
 */

require('dotenv').config();
const http = require('http');
const cron = require('node-cron');
const connectDB = require('./db');
const { runMonitoringCycle } = require('./services/alerts');
const { sendCreditExpiryReminder, sendPolicyChangeAlert, sendOnboardingDay3, sendOnboardingDay7 } = require('./services/email');
const { refreshAllPolicies, getRecentPolicyChanges } = require('./services/policyAgent');
const { seedPolicies } = require('./services/policyAgent');
const Booking = require('./models/Booking');
const User    = require('./models/User');

const start = async () => {
  // Minimal HTTP server so Railway health checks pass
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'TripReclaim Monitor',
      uptime: process.uptime(),
    }));
  });
  server.listen(process.env.PORT || 3001, () => {
    console.log(`✅ Health server listening on port ${process.env.PORT || 3001}`);
  });

  console.log('🕐 TripReclaim Monitor starting...');
  await connectDB();

  // Seed airline policies on startup (safe to run multiple times — $setOnInsert)
  try {
    await seedPolicies();
  } catch (err) {
    console.error('[cron] Policy seed error:', err.message);
  }

  // ── Run monitoring cycle immediately on startup ──
  await runMonitoringCycle();

  // ── Every 15 minutes: check which bookings are due ──
  // Each booking tracks its own nextCheckAt, so this just polls frequently
  // and the booking's adaptive schedule determines if it's actually due.
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runMonitoringCycle();
    } catch (err) {
      console.error('[cron] Monitoring cycle error:', err.message);
    }
  });

  // ── Daily at 9am UTC: Credit expiry reminders ──
  // Finds all bookings with claimed credits expiring in ≤30 days or ≤7 days
  // and sends reminder emails at both thresholds.
  cron.schedule('0 9 * * *', async () => {
    console.log('[cron] Running credit expiry reminder check...');
    try {
      await sendCreditExpiryReminders();
    } catch (err) {
      console.error('[cron] Credit expiry reminder error:', err.message);
    }
  });

  // ── Every Monday at 3am UTC: Weekly policy refresh ──
  // Scrapes all airline policy pages via Firecrawl.
  // If a policy change is detected, notifies affected active subscribers.
  
  // ── Daily onboarding sequence check (Day 3 and Day 7 emails) ──
  cron.schedule('0 10 * * *', async () => {
    try {
      const now = new Date();

      // Day 3 email: users where onboardingEmailStep=1 and createdAt >= 3 days ago
      const day3Threshold = new Date(now - 3 * 24 * 60 * 60 * 1000);
      const day3Users = await User.find({
        onboardingEmailStep: 1,
        createdAt: { $lte: day3Threshold },
      }).limit(50);

      for (const user of day3Users) {
        try {
          await sendOnboardingDay3(user.email, user);
          await User.findByIdAndUpdate(user._id, { onboardingEmailStep: 2 });
          console.log(`[cron] Day 3 onboarding email sent to ${user.email}`);
        } catch (e) {
          console.error(`[cron] Day 3 email failed for ${user.email}:`, e.message);
        }
      }

      // Day 7 email: users where onboardingEmailStep=2 and createdAt >= 7 days ago
      const day7Threshold = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const day7Users = await User.find({
        onboardingEmailStep: 2,
        createdAt: { $lte: day7Threshold },
      }).limit(50);

      for (const user of day7Users) {
        try {
          await sendOnboardingDay7(user.email, user);
          await User.findByIdAndUpdate(user._id, { onboardingEmailStep: 3 });
          console.log(`[cron] Day 7 onboarding email sent to ${user.email}`);
        } catch (e) {
          console.error(`[cron] Day 7 email failed for ${user.email}:`, e.message);
        }
      }
    } catch (err) {
      console.error('[cron] Onboarding sequence error:', err.message);
    }
  });

  cron.schedule('0 3 * * 1', async () => {
    console.log('[cron] Running weekly airline policy refresh...');
    try {
      await runWeeklyPolicyRefresh();
    } catch (err) {
      console.error('[cron] Policy refresh error:', err.message);
    }
  });

  console.log('✅ TripReclaim Monitor running');
  console.log('   • Price checks:    every 15 minutes (adaptive per booking)');
  console.log('   • Credit reminders: daily at 9am UTC');
  console.log('   • Policy refresh:   every Monday at 3am UTC');
  console.log('   Booking check intervals:');
  console.log('   • First hour post-booking  → every 15 min');
  console.log('   • Hours 1-6 post-booking   → every 30 min');
  console.log('   • Hours 6-24 post-booking  → every hour');
  console.log('   • 0-3 days to departure    → every hour');
  console.log('   • 4-14 days to departure   → every 3 hours');
  console.log('   • 15-30 days to departure  → every 6 hours');
  console.log('   • 30+ days to departure    → once daily');
};

// ─────────────────────────────────────────────────────────────────────────────
// Credit expiry reminder logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find all bookings with claimed credits expiring soon and send reminders.
 * Sends at two thresholds: 30 days and 7 days before expiry.
 */
const sendCreditExpiryReminders = async () => {
  const now = new Date();

  // Credits expiring in ≤30 days (but > 7 days — the 7-day bucket handles those)
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const in7Days  = new Date(now.getTime() +  7 * 24 * 60 * 60 * 1000);

  // Find all uncollected / expiring credits
  const expiringBookings = await Booking.find({
    creditClaimed: true,
    creditExpiryDate: { $gte: now, $lte: in30Days },
  }).lean();

  if (!expiringBookings.length) {
    console.log('[cron] No expiring credits found');
    return;
  }

  let remindersSent = 0;

  for (const booking of expiringBookings) {
    const msLeft   = new Date(booking.creditExpiryDate) - now;
    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

    // Only send at the 30-day and 7-day thresholds (±1 day tolerance)
    const is30DayThreshold = daysLeft >= 29 && daysLeft <= 31;
    const is7DayThreshold  = daysLeft >= 6  && daysLeft <= 8;

    if (!is30DayThreshold && !is7DayThreshold) continue;

    try {
      await sendCreditExpiryReminder(booking.email, booking, daysLeft);
      remindersSent++;
      console.log(
        `[cron] Credit expiry reminder sent to ${booking.email} ` +
        `(${booking.airline} — ${daysLeft} days)`
      );
    } catch (err) {
      console.error(
        `[cron] Failed to send credit reminder for booking ${booking._id}: ${err.message}`
      );
    }

    // Throttle email sending
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[cron] Credit expiry reminders sent: ${remindersSent}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Weekly policy refresh logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scrape all airline policy pages and notify affected subscribers if changes detected.
 */
const runWeeklyPolicyRefresh = async () => {
  // 1. Run the scrape
  const refreshResults = await refreshAllPolicies();

  // 2. Which airlines had a detected change?
  const changedCodes = refreshResults
    .filter(r => r.changed)
    .map(r => r.code);

  if (!changedCodes.length) {
    console.log('[cron] Policy refresh: no changes detected');
    return;
  }

  console.log(`[cron] Policy changes detected for: ${changedCodes.join(', ')}`);

  // 3. For each changed airline, find active bookings with that airline
  //    and notify their owners
  const AirlinePolicy = require('./models/AirlinePolicy');

  for (const code of changedCodes) {
    // Get the airline display name from the policy record
    const policyDoc = await AirlinePolicy.findOne({ code }).lean();
    if (!policyDoc) continue;

    const airlineName = policyDoc.airline;

    // Find all active bookings for this airline with active users
    const affectedBookings = await Booking.find({
      airline: airlineName,
      status: 'active',
    }).lean();

    if (!affectedBookings.length) continue;

    // Group by email to send one email per user (may have multiple flights)
    const byEmail = {};
    for (const b of affectedBookings) {
      if (!byEmail[b.email]) byEmail[b.email] = [];
      byEmail[b.email].push(`${b.origin} → ${b.destination}`);
    }

    for (const [email, routes] of Object.entries(byEmail)) {
      try {
        await sendPolicyChangeAlert(email, airlineName, routes);
        console.log(`[cron] Policy change alert sent to ${email} for ${airlineName}`);
      } catch (err) {
        console.error(`[cron] Failed to send policy change alert to ${email}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }
};

start().catch(err => {
  console.error('❌ Failed to start monitor:', err.message);
  process.exit(1);
});

// Keep process alive
process.on('SIGTERM', () => {
  console.log('Monitor shutting down gracefully...');
  process.exit(0);
});
