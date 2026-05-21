const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { requireAuth } = require('../middleware/auth');

/**
 * GET /billing/portal
 * Create a Stripe customer portal session and return the URL
 */
router.get('/portal', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing account found. Please contact support.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/dashboard/`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[billing] Portal error:', err.message);
    res.status(500).json({ error: 'Failed to open billing portal' });
  }
});

/**
 * GET /billing/status
 * Return current plan and billing status
 */
router.get('/status', requireAuth, async (req, res) => {
  const { plan, planStatus, tripsRemaining, stripeCustomerId, stripeSubscriptionId } = req.user;
  res.json({ plan, planStatus, tripsRemaining, hasStripe: !!stripeCustomerId, hasSubscription: !!stripeSubscriptionId });
});

module.exports = router;
