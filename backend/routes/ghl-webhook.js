/**
 * GHL Webhook Receiver
 * Handles inbound webhooks from GoHighLevel automations.
 * GHL can call this endpoint to trigger actions in TripReclaim.
 *
 * Supported events:
 *   - contact.unsubscribed  → pause monitoring for user
 *   - contact.tag_applied   → sync tag actions (e.g. upgrade, churn)
 *   - custom.upgrade_request → trigger upgrade flow
 */
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Booking = require('../models/Booking');

/**
 * POST /webhooks/ghl
 * Receives automation events from GHL.
 * Secured by a shared secret in the GHL_WEBHOOK_SECRET env var (optional).
 */
router.post('/', express.json(), async (req, res) => {
  try {
    // Optional: verify shared secret (set GHL_WEBHOOK_SECRET in Railway and GHL automation)
    const secret = req.headers['x-ghl-secret'] || req.headers['authorization'];
    if (process.env.GHL_WEBHOOK_SECRET && secret !== process.env.GHL_WEBHOOK_SECRET) {
      console.warn('[ghl-webhook] Unauthorized request — wrong or missing secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { type, email, contactId, tags, data } = req.body;
    console.log(`[ghl-webhook] Event: ${type} | email: ${email} | contactId: ${contactId}`);

    if (!type) {
      return res.status(400).json({ error: 'Missing event type' });
    }

    // Respond immediately
    res.json({ received: true, type });

    // Process async
    setImmediate(() => handleGhlEvent({ type, email, contactId, tags, data })
      .catch(err => console.error('[ghl-webhook] Processing error:', err.message))
    );
  } catch (err) {
    console.error('[ghl-webhook] Outer error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  }
});

async function handleGhlEvent({ type, email, contactId, tags, data }) {
  switch (type) {

    // User unsubscribed or opted out in GHL — pause their monitoring
    case 'contact.unsubscribed':
    case 'contact.opted_out': {
      if (!email) break;
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        console.log(`[ghl-webhook] No user found for ${email}`);
        break;
      }
      // Pause all active bookings
      const result = await Booking.updateMany(
        { userId: user._id, status: 'active' },
        { $set: { status: 'paused' } }
      );
      console.log(`[ghl-webhook] Paused ${result.modifiedCount} bookings for ${email} (opt-out)`);
      break;
    }

    // Contact upgraded their plan (GHL automation triggered after payment)
    case 'contact.plan_upgraded': {
      if (!email || !data?.newPlan) break;
      const validPlans = ['per_trip', 'monthly', 'annual'];
      if (!validPlans.includes(data.newPlan)) break;
      await User.findOneAndUpdate(
        { email: email.toLowerCase() },
        { $set: { plan: data.newPlan } }
      );
      console.log(`[ghl-webhook] Plan updated to ${data.newPlan} for ${email}`);
      break;
    }

    // Generic tag applied event — log for now, extend as needed
    case 'contact.tag_applied': {
      console.log(`[ghl-webhook] Tags applied to ${email}:`, tags);
      // Future: handle specific tags like 'cancel-requested', 'vip-user', etc.
      break;
    }

    // Re-engagement: user clicked re-engagement email from GHL
    case 'contact.re_engaged': {
      if (!email) break;
      console.log(`[ghl-webhook] Re-engagement event for ${email}`);
      // Future: trigger onboarding nudge email, restore paused bookings, etc.
      break;
    }

    default:
      console.log(`[ghl-webhook] Unhandled event type: ${type}`);
  }
}

module.exports = router;
