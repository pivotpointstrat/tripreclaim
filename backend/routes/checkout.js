const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PLAN_CONFIG = {
  per_trip: {
    priceId: process.env.STRIPE_PRICE_PER_TRIP,
    mode: 'payment',
  },
  monthly: {
    priceId: process.env.STRIPE_PRICE_MONTHLY,
    mode: 'subscription',
  },
  annual: {
    priceId: process.env.STRIPE_PRICE_ANNUAL,
    mode: 'subscription',
  },
};

/**
 * GET /api/checkout?plan=monthly&ref=YYIIHL9W
 * Creates a Stripe Checkout Session server-side so client_reference_id
 * is always set — even if the user never touched the landing page JS.
 */
router.get('/', async (req, res) => {
  const { plan = 'monthly', ref } = req.query;
  const config = PLAN_CONFIG[plan];

  if (!config || !config.priceId) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  const frontendUrl = (process.env.FRONTEND_URL || 'https://tripreclaim.com').replace(//$/, '');

  const sessionParams = {
    mode: config.mode,
    line_items: [{ price: config.priceId, quantity: 1 }],
    success_url: `${frontendUrl}/dashboard/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/#pricing`,
    allow_promotion_codes: true,
  };

  // Set client_reference_id server-side — reliable regardless of client JS
  if (ref && /^[A-Za-z0-9]{6,20}$/.test(ref)) {
    sessionParams.client_reference_id = `ref:${ref}`;
    console.log(`[checkout] Referral code captured server-side: ${ref}`);
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    res.redirect(303, session.url);
  } catch (err) {
    console.error('[checkout] Stripe session creation failed:', err.message);
    res.status(500).json({ error: 'Could not create checkout session' });
  }
});

module.exports = router;
