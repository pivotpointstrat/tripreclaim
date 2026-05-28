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
 * GET /billing/info
 * Return billing context: next bill date, credit balance, threshold info for upsell
 */
router.get('/info', requireAuth, async (req, res) => {
  const User = require('../models/User');
  const freshUser = await User.findById(req.user._id).lean();
  const credit = freshUser?.accountCredit || 0;

  let nextBillDate = null;
  let currentPeriodEnd = null;

  if (freshUser?.stripeSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(freshUser.stripeSubscriptionId);
      currentPeriodEnd = sub.current_period_end;
      nextBillDate = new Date(currentPeriodEnd * 1000).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric'
      });
    } catch (e) {
      console.warn('[billing] info - could not retrieve subscription:', e.message);
    }
  }

  const MONTHLY = 5.99;
  const ANNUAL  = 49.00;

  res.json({
    plan:               freshUser?.plan || null,
    nextBillDate,
    currentPeriodEnd,
    accountCredit:      parseFloat(credit.toFixed(2)),
    monthlyPrice:       MONTHLY,
    annualPrice:        ANNUAL,
    monthlyAfterCredit: parseFloat(Math.max(0, MONTHLY - credit).toFixed(2)),
    annualAfterCredit:  parseFloat(Math.max(0, ANNUAL  - credit).toFixed(2)),
    monthsCovered:      Math.floor(credit / MONTHLY),
    creditCoversAnnual: credit >= ANNUAL,
    annualThreshold:    ANNUAL,
    nudgeAmount:        parseFloat(Math.max(0, ANNUAL - credit).toFixed(2)),
  });
});

/**
 * POST /billing/apply-credit
 * Apply account credit using Stripe Customer Balance (auto-applies to all future invoices)
 * plan = 'subscription' → add full credit to Stripe balance (covers multiple months automatically)
 * plan = 'annual'       → upgrade subscription to annual + add credit to Stripe balance
 */
router.post('/apply-credit', requireAuth, async (req, res) => {
  const { plan } = req.body;
  if (!['subscription', 'annual'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan. Use subscription or annual.' });
  }

  const User = require('../models/User');
  const freshUser = await User.findById(req.user._id).lean();
  const credit = freshUser?.accountCredit || 0;

  if (credit <= 0) return res.status(400).json({ error: 'No account credit available.' });
  if (!freshUser?.stripeCustomerId) {
    return res.status(400).json({ error: 'No Stripe account found. Please contact support.' });
  }

  const creditCents = Math.round(credit * 100); // full amount — not capped

  try {
    if (plan === 'annual') {
      // Upgrade existing subscription to annual price
      if (freshUser?.stripeSubscriptionId) {
        const sub = await stripe.subscriptions.retrieve(freshUser.stripeSubscriptionId);
        await stripe.subscriptions.update(freshUser.stripeSubscriptionId, {
          items: [{ id: sub.items.data[0].id, price: process.env.STRIPE_PRICE_ANNUAL }],
          proration_behavior: 'none',
        });
      }

      // Add full credit as Stripe customer balance (auto-applies to next invoice)
      await stripe.customers.createBalanceTransaction(freshUser.stripeCustomerId, {
        amount: -creditCents,
        currency: 'usd',
        description: `TripReclaim referral credit — $${credit.toFixed(2)} applied to annual plan`,
      });

      // Update MongoDB: plan = annual, zero out credit (Stripe owns it now)
      await User.findByIdAndUpdate(freshUser._id, {
        plan: 'annual',
        accountCredit: 0,
      });

      const annualCost = 49.00;
      const remaining = parseFloat(Math.max(0, credit - annualCost).toFixed(2));
      const charged   = parseFloat(Math.max(0, annualCost - credit).toFixed(2));

      res.json({
        ok: true,
        creditApplied: credit,
        charged,
        remaining,
        message: credit >= annualCost
          ? `Annual plan activated! Your $${credit.toFixed(2)} credit covers the full $49 plan.${ remaining > 0 ? ` $${remaining.toFixed(2)} remaining credit will auto-apply to future renewals.` : ''}`
          : `Annual upgrade applied. $${credit.toFixed(2)} credit reduces your first annual bill to $${charged.toFixed(2)}.`,
      });

    } else {
      // Apply full credit to Stripe customer balance — auto-applies across multiple monthly invoices
      await stripe.customers.createBalanceTransaction(freshUser.stripeCustomerId, {
        amount: -creditCents,
        currency: 'usd',
        description: `TripReclaim referral credit — $${credit.toFixed(2)} added to account`,
      });

      // Zero out credit in MongoDB (Stripe owns it now)
      await User.findByIdAndUpdate(freshUser._id, { accountCredit: 0 });

      const monthsCovered = Math.floor(credit / 5.99);
      const remainder     = parseFloat((credit % 5.99).toFixed(2));

      res.json({
        ok: true,
        creditApplied: credit,
        monthsCovered,
        remainder,
        message: `$${credit.toFixed(2)} credit applied to your account. Stripe will automatically cover your next ${ monthsCovered > 1 ? `${monthsCovered} monthly bills` : 'monthly bill' } — no action needed each month.${ remainder > 0 ? ` ($${remainder.toFixed(2)} remaining after ${monthsCovered} month${monthsCovered !== 1 ? 's' : ''})` : '' }`,
      });
    }
  } catch (err) {
    console.error('[billing] apply-credit error:', err.message);
    res.status(500).json({ error: 'Failed to apply credit: ' + err.message });
  }
});

module.exports = router;
