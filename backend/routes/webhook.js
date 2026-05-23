const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const { generateMagicToken } = require('../middleware/auth');
const { sendMagicLink, sendOnboardingDay0 } = require('../services/email');
const { upsertContact } = require('../services/ghl');

// Plan mapping from Stripe price IDs
const PRICE_TO_PLAN = {
  [process.env.STRIPE_PRICE_PER_TRIP]: 'per_trip',
  [process.env.STRIPE_PRICE_MONTHLY]: 'monthly',
  [process.env.STRIPE_PRICE_ANNUAL]: 'annual',
};

/**
 * POST /webhook/stripe
 * Receives and processes Stripe webhook events.
 * Uses raw body for signature verification.
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`[webhook] Signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[webhook] Event received: ${event.type}`);

  try {
    switch (event.type) {

      // ── One-time payment completed (per_trip plan) ──
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email = session.customer_details?.email || session.customer_email;
        if (!email) break;

        // Determine plan from line items
        let plan = 'per_trip';
        if (session.mode === 'subscription') {
          // Subscription handled by customer.subscription.created
          break;
        }

        await handleNewUser(email, session.customer, plan, null);
        break;
      }

      // ── New subscription started (monthly or annual) ──
      case 'customer.subscription.created': {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const email = customer.email;
        if (!email) break;

        const priceId = sub.items.data[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || 'monthly';

        await handleNewUser(email, sub.customer, plan, sub.id);
        break;
      }

      // ── Subscription updated (upgrade/downgrade) ──
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const priceId = sub.items.data[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId];
        const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'canceled';

        await User.findOneAndUpdate(
          { stripeSubscriptionId: sub.id },
          { plan, planStatus: status }
        );
        break;
      }

      // ── Subscription canceled ──
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await User.findOneAndUpdate(
          { stripeSubscriptionId: sub.id },
          { planStatus: 'canceled' }
        );
        break;
      }

      // ── Payment failed ──
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await User.findOneAndUpdate(
          { stripeCustomerId: invoice.customer },
          { planStatus: 'past_due' }
        );
        break;
      }

      default:
        // Unhandled event type — ignore
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error(`[webhook] Error processing ${event.type}: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Create or update user after successful payment,
 * then send magic link welcome email.
 */
async function handleNewUser(email, stripeCustomerId, plan, subscriptionId) {
  // Upsert user
  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    {
      $set: {
        stripeCustomerId,
        plan,
        planStatus: 'active',
        ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
        ...(plan === 'per_trip' ? { $inc: { tripsRemaining: 1 } } : {}),
      },
    },
    { upsert: true, new: true }
  );

  // Generate magic link
  const token = generateMagicToken(email);
  const magicUrl = `${process.env.FRONTEND_URL}/dashboard?token=${token}`;

  // Send welcome email with dashboard link
  await sendMagicLink(email, magicUrl, plan);
  // Send Day 0 onboarding welcome email
  try {
    await sendOnboardingDay0(email, user);
    await User.findByIdAndUpdate(user._id, { onboardingEmailStep: 1 });
  } catch (e) {
    console.error('[webhook] Day 0 email failed:', e.message);
  }
  console.log(`[webhook] ✅ New user onboarded: ${email} (${plan}) — magic link sent`);

  // Sync to GHL CRM (non-fatal)
  try {
    await upsertContact({ email, name: user.name || '', plan,
      note: `New TripReclaim signup via Stripe — plan: ${plan}` });
    console.log('[webhook] GHL contact synced:', email);
  } catch (ghlErr) {
    console.error('[webhook] GHL sync failed:', ghlErr.message);
  }
}

module.exports = router;
