const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Booking = require('../models/Booking');
const { Resend } = require('resend');
const { generateMagicToken } = require('../middleware/auth');
const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/leads — start a real 24-hour free trial from the calculator
router.post('/', async (req, res) => {
  try {
    const { email, origin, destination, departureDate, pricePaid, returnDate, tripType } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const routeLabel = (origin && destination) ? `${origin} → ${destination}` : 'your route';
    const depLabel = departureDate
      ? new Date(departureDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : 'your departure date';
    const priceLabel = pricePaid ? `$${Number(pricePaid).toLocaleString()}` : null;
    const trialExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h from now

    // Find or create user
    let user = await User.findOne({ email: email.toLowerCase() });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = new User({
        email: email.toLowerCase(),
        plan: 'trial',
        planStatus: 'active',
        trialExpiresAt,
        trialOrigin: origin || null,
        trialDestination: destination || null,
        trialDepartureDate: departureDate || null,
        trialPricePaid: pricePaid ? parseFloat(pricePaid) : null,
        createdAt: new Date(),
      });
      await user.save();
    } else if (!user.plan || user.plan === 'lead') {
      // Upgrade lead to trial
      user.plan = 'trial';
      user.planStatus = 'active';
      user.trialExpiresAt = trialExpiresAt;
      user.trialOrigin = origin || user.trialOrigin;
      user.trialDestination = destination || user.trialDestination;
      user.trialDepartureDate = departureDate || user.trialDepartureDate;
      user.trialPricePaid = pricePaid ? parseFloat(pricePaid) : user.trialPricePaid;
      await user.save();
    }

    // Create a trial booking if we have route details
    let bookingCreated = false;
    if (origin && destination && departureDate) {
      const existingBooking = await Booking.findOne({
        userId: user._id,
        origin: origin.toUpperCase(),
        destination: destination.toUpperCase(),
        departureDate: new Date(departureDate),
        isTrial: true,
      });

      if (!existingBooking) {
        const booking = new Booking({
          userId: user._id,
          airline: null, // unknown from calculator
          origin: origin.toUpperCase(),
          destination: destination.toUpperCase(),
          departureDate: new Date(departureDate),
          returnDate: returnDate ? new Date(returnDate) : null,
          cabinClass: 'Economy',
          pricePaid: pricePaid ? parseFloat(pricePaid) : 0,
          passengers: 1,
          monitoringActive: true,
          isTrial: true,
          matchMode: 'flexible',
          createdAt: new Date(),
        });
        await booking.save();
        bookingCreated = true;
      }
    }

    // Generate magic link for dashboard access
    const magicToken = generateMagicToken(user.email);
    const magicLink = `${process.env.FRONTEND_URL || 'https://tripreclaim.com'}/dashboard/?token=${magicToken}&trial=1`;

    // Send magic link email
    const emailHtml = `
      <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
        <div style="background:linear-gradient(135deg,#0f172a,#1d4ed8);padding:32px;border-radius:16px 16px 0 0;text-align:center">
          <img src="https://tripreclaim.com/logos/logo.png" alt="TripReclaim" style="height:36px;margin-bottom:16px">
          <h1 style="color:#fff;font-size:1.4rem;margin:0;font-weight:800">✅ Your free 24-hour trial has started</h1>
        </div>
        <div style="background:#fff;padding:32px;border:1px solid #e2e8f0;border-top:none">
          <p style="font-size:1rem;margin:0 0 16px">Hi there,</p>
          <p style="margin:0 0 24px;color:#475569">We're now monitoring <strong>${routeLabel}</strong>${departureDate ? ` on <strong>${depLabel}</strong>` : ''}${priceLabel ? ` — paid fare: <strong>${priceLabel}</strong>` : ''}. If the price drops in the next 24 hours, you'll get an instant alert with step-by-step instructions to claim your money back.</p>

          <div style="background:#ecfdf5;border-radius:12px;padding:20px;margin-bottom:24px">
            <p style="margin:0 0 8px;font-weight:700;font-size:0.9rem;color:#065f46">⚡ What's happening right now:</p>
            <ul style="margin:0;padding-left:20px;color:#475569;font-size:0.9rem;line-height:1.8">
              <li>Checking prices every 15 minutes for the next 24 hours</li>
              <li>Comparing against your paid fare${priceLabel ? ` of ${priceLabel}` : ''}</li>
              <li>If a drop is detected → instant email alert + full Claim Kit</li>
            </ul>
          </div>

          <div style="text-align:center;margin-bottom:24px">
            <a href="${magicLink}" style="display:inline-block;background:#2563eb;color:#fff;padding:16px 36px;border-radius:10px;font-weight:700;text-decoration:none;font-size:1rem">View Your Dashboard →</a>
            <p style="margin:8px 0 0;font-size:0.75rem;color:#94a3b8">Link expires in 1 hour. New link? Just email us.</p>
          </div>

          <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:20px;margin-bottom:24px">
            <p style="margin:0 0 8px;font-weight:700;font-size:0.9rem;color:#9a3412">⏱️ Trial expires in 24 hours</p>
            <p style="margin:0;font-size:0.875rem;color:#9a3412">Your free monitoring stops tomorrow. To keep watching this flight all the way to departure — and protect every trip you book — continue for just <strong>$2.99/trip</strong>.</p>
          </div>

          <div style="text-align:center;margin-bottom:24px">
            <a href="https://tripreclaim.com/#pricing" style="display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:10px;font-weight:700;text-decoration:none;font-size:0.9rem">Continue Monitoring — $2.99/trip →</a>
          </div>

          <p style="margin:0;color:#94a3b8;font-size:0.8rem;text-align:center">TripReclaim · <a href="https://tripreclaim.com" style="color:#94a3b8">tripreclaim.com</a> · <a href="https://tripreclaim.com/privacy/" style="color:#94a3b8">Privacy</a></p>
        </div>
      </div>
    `;

    await resend.emails.send({
      from: 'TripReclaim <hello@tripreclaim.com>',
      to: user.email,
      subject: `✅ Monitoring ${routeLabel} — free for 24 hours`,
      html: emailHtml,
    });

    res.json({
      success: true,
      message: 'Trial started — check your email for dashboard access',
      isNewUser,
      bookingCreated,
    });
  } catch (err) {
    console.error('Trial start error:', err);
    res.status(500).json({ error: 'Failed to start trial' });
  }
});

module.exports = router;
