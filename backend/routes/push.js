const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const PushSubscription = require('../models/PushSubscription');
const { sendPushToUser } = require('../services/push');

/**
 * POST /api/push/subscribe
 * Save a browser push subscription for the authenticated user
 */
router.post('/subscribe', requireAuth, async (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }
  try {
    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        userId: req.user._id,
        email: req.user.email,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        userAgent: req.headers['user-agent'],
        active: true,
      },
      { upsert: true, new: true }
    );
    console.log(`[push] Subscribed: ${req.user.email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[push] Subscribe error:', err.message);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

/**
 * DELETE /api/push/unsubscribe
 * Remove push subscription for authenticated user
 */
router.delete('/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body;
  try {
    if (endpoint) {
      await PushSubscription.findOneAndUpdate({ endpoint }, { active: false });
    } else {
      await PushSubscription.updateMany({ userId: req.user._id }, { active: false });
    }
    console.log(`[push] Unsubscribed: ${req.user.email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[push] Unsubscribe error:', err.message);
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

/**
 * POST /api/push/test
 * Send a test push notification to the authenticated user
 */
router.post('/test', requireAuth, async (req, res) => {
  try {
    await sendPushToUser(
      req.user._id,
      'TripReclaim — Push Notifications Active',
      'You will now receive instant price drop alerts on this device.',
      'https://tripreclaim.com/dashboard/'
    );
    res.json({ ok: true, message: 'Test notification sent' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

module.exports = router;
