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

/**
 * POST /billing/create-upgrade-checkout
 * Create a Stripe checkout session for monthly/annual upgrade with account credit applied
 */
router.post('/create-upgrade-checkout', requireAuth, async (req, res) => {
  const { plan } = req.body;
  if (!['monthly', 'annual'].includes(plan)) {
    return res.status(400).json({ error: 'Credit can only be applied to monthly or annual plans' });
  }

  const user = req.user;
  const User = require('../models/User');
  const freshUser = await User.findById(user._id).lean();
  const accountCredit = freshUser?.accountCredit || 0;

  const priceId = plan === 'monthly'
    ? process.env.STRIPE_PRICE_MONTHLY
    : process.env.STRIPE_PRICE_ANNUAL;
  const planAmountCents = plan === 'monthly' ? 599 : 4900;
  const creditCents = Math.min(Math.floor(accountCredit * 100), planAmountCents);

  try {
    let discounts = [];
    let couponId = null;

    if (creditCents > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: creditCents,
        currency: 'usd',
        duration: 'once',
        name: `TripReclaim referral credit ($${(creditCents / 100).toFixed(2)})`,
        max_redemptions: 1,
      });
      couponId = coupon.id;
      discounts = [{ coupon: couponId }];
    }

    const sessionParams = {
      mode: 'subscription', // both monthly and annual are Stripe recurring subscriptions
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
      success_url: `${process.env.FRONTEND_URL}/dashboard/?upgraded=1`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard/`,
      metadata: {
        creditApplied: creditCents.toString(),
        userId: user._id.toString(),
        couponId: couponId || '',
      },
    };
    if (discounts.length > 0) sessionParams.discounts = discounts;

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url, creditApplied: creditCents / 100 });
  } catch (err) {
    console.error('[billing] create-upgrade-checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

module.exports = router;
