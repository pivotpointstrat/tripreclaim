require('dotenv').config();
const cron = require('node-cron');
const { runMonitoringCycle } = require('./services/alerts');
const { sendCreditExpiryReminder, sendOnboardingDay3, sendOnboardingDay7 } = require('./services/email');
const { refreshAllPolicies, getRecentPolicyChanges } = require('./services/policyAgent');
const Booking = require('./models/Booking');
const User    = require('./models/User');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const connectDB = require('./db');

const app = express();

// ── Security ──
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'https://tripreclaim.com',
      'https://www.tripreclaim.com',
      'http://localhost:3001',
      'http://localhost:3000',
    ];
    // Also allow the configured FRONTEND_URL (strip trailing slash)
    const envUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    if (envUrl) allowed.push(envUrl);
    // Allow requests with no origin (e.g. curl, mobile apps, Stripe webhooks)
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));

// ── Rate limiting ──
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use(limiter);

// ── Body parsing ──
// IMPORTANT: Stripe webhook route needs raw body — mount BEFORE json middleware
app.use('/webhooks', require('./routes/twilio-webhook'));
app.use('/webhooks/email-inbound', require('./routes/email-inbound'));
app.use('/webhooks/ghl', require('./routes/ghl-webhook'));
app.use('/webhook', require('./routes/webhook'));

// JSON body parser for all other routes
app.use(express.json());

// ── Routes ──
app.use('/auth', require('./routes/auth'));
app.use('/bookings', require('./routes/bookings'));
app.use('/api/credits', require('./routes/credits'));
app.use('/bookings', require('./routes/evidence'));
app.use('/lookup', require('./routes/lookup'));
const policyRoutes = require('./routes/policy');
app.use('/policy', policyRoutes);
app.use('/billing', require('./routes/billing'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/checkout', require('./routes/checkout'));
app.use('/api/support', require('./routes/support'));

// ── Health check ──
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TripReclaim API',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
  });
});

// ── 404 handler ──
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──
const PORT = process.env.PORT || 3000;

const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`✅ TripReclaim API running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Frontend:    ${process.env.FRONTEND_URL}`);
  });
  // ── Background monitoring cron jobs ──
  // Run immediately on startup, then every 15 minutes
  runMonitoringCycle().catch(err => console.error('[cron] Initial cycle error:', err.message));

  cron.schedule('*/15 * * * *', async () => {
    try { await runMonitoringCycle(); }
    catch (err) { console.error('[cron] Monitoring cycle error:', err.message); }
  });

  // Daily 9am UTC: Credit expiry reminders & onboarding drip
  cron.schedule('0 9 * * *', async () => {
    try {
      const now = new Date();
      const day3Users = await User.find({
        plan: { $ne: null },
        onboardingEmailStep: 1,
        createdAt: { $lte: new Date(now - 3 * 24 * 60 * 60 * 1000) }
      });
      for (const u of day3Users) {
        await sendOnboardingDay3(u.email);
        await User.findByIdAndUpdate(u._id, { onboardingEmailStep: 2 });
      }
      const day7Users = await User.find({
        plan: { $ne: null },
        onboardingEmailStep: 2,
        createdAt: { $lte: new Date(now - 7 * 24 * 60 * 60 * 1000) }
      });
      for (const u of day7Users) {
        await sendOnboardingDay7(u.email);
        await User.findByIdAndUpdate(u._id, { onboardingEmailStep: 3 });
      }
      await sendCreditExpiryReminder();
    } catch (err) { console.error('[cron] Daily email error:', err.message); }
  });

  // Weekly Monday 3am UTC: Airline policy refresh
  cron.schedule('0 3 * * 1', async () => {
    try {
      console.log('[cron] Starting weekly policy refresh...');
      await refreshAllPolicies();
      const changes = await getRecentPolicyChanges(7);
      if (changes.length) console.log(`[cron] Policy refresh complete — ${changes.length} changes detected`);
    } catch (err) { console.error('[cron] Policy refresh error:', err.message); }
  });

  console.log('✅ Monitoring cron jobs started (15min cycle + daily + weekly)');

};

start();

module.exports = app;
