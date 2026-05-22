const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Booking = require('../models/Booking');
const { parseConfirmationEmail } = require('../services/emailParser');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * POST /webhooks/email-inbound
 * Receives forwarded confirmation emails from Resend inbound routing.
 * Parses the email, finds the user account, and creates a monitoring entry.
 */
router.post('/', express.json(), async (req, res) => {
  try {
    // Resend inbound email payload
    const { from, to, subject, text, html, headers } = req.body;

    console.log(`[email-inbound] Received email from ${from} to ${to} | Subject: ${subject}`);

    // Acknowledge Resend immediately (must respond within 10s)
    res.json({ received: true });

    // Extract the TripReclaim user's email from the "to" or "Reply-To" field
    // When user forwards email, the "from" of the forwarded email IS the user's email
    // The original sender is in the body/headers
    const forwarderEmail = extractForwarderEmail(from, headers);
    if (!forwarderEmail) {
      console.log('[email-inbound] Could not determine forwarder email — skipping');
      return;
    }

    // Find the TripReclaim account matching the forwarder email
    const user = await User.findOne({ email: forwarderEmail.toLowerCase() });
    if (!user) {
      console.log(`[email-inbound] No TripReclaim account found for ${forwarderEmail}`);
      // Send a helpful reply
      await resend.emails.send({
        from: 'TripReclaim <hello@tripreclaim.com>',
        to: forwarderEmail,
        subject: 'We couldn\'t find your TripReclaim account',
        html: `
          <p>Hi there,</p>
          <p>We received your forwarded confirmation email but couldn't find a TripReclaim account linked to <strong>${forwarderEmail}</strong>.</p>
          <p>To use email monitoring, please <a href="https://tripreclaim.com">sign up for TripReclaim</a> first, then forward your confirmation email.</p>
          <p>— The TripReclaim Team</p>
        `
      });
      return;
    }

    // Parse the confirmation email
    const parseResult = parseConfirmationEmail({ from, subject, text, html });

    if (!parseResult.success) {
      console.log(`[email-inbound] Parse failed (confidence: ${parseResult.confidence}):`, parseResult.missingFields);
      // Notify user of parse failure
      await resend.emails.send({
        from: 'TripReclaim <hello@tripreclaim.com>',
        to: user.email,
        subject: 'We couldn\'t read your confirmation email',
        html: `
          <p>Hi ${user.name || 'there'},</p>
          <p>We received your forwarded email but had trouble extracting the flight details automatically.</p>
          <p><strong>Missing:</strong> ${parseResult.missingFields.join(', ')}</p>
          <p>Please <a href="https://tripreclaim.com/dashboard/">add your flight manually</a> in your dashboard — it only takes 30 seconds.</p>
          <p>— The TripReclaim Team</p>
        `
      });
      return;
    }

    const { data, confidence, missingFields } = parseResult;
    console.log(`[email-inbound] ✅ Parsed ${data.airline} booking (confidence: ${confidence}%):`, data);

    // Check flight cap for user plan
    const planCaps = { per_trip: 1, monthly: 5, annual: 15 };
    const cap = planCaps[user.plan] || 1;
    const activeCount = await Booking.countDocuments({ userId: user._id, status: 'monitoring' });

    if (activeCount >= cap) {
      await resend.emails.send({
        from: 'TripReclaim <hello@tripreclaim.com>',
        to: user.email,
        subject: 'Flight monitoring limit reached',
        html: `
          <p>Hi ${user.name || 'there'},</p>
          <p>We received your confirmation email for ${data.airline ? data.airline + ' ' : ''}${data.origin || ''}→${data.destination || ''} but your plan allows a maximum of <strong>${cap} simultaneous flights</strong>.</p>
          <p>You currently have <strong>${activeCount}</strong> flights being monitored.</p>
          <p><a href="https://tripreclaim.com/dashboard/">Upgrade your plan</a> to monitor more flights.</p>
          <p>— The TripReclaim Team</p>
        `
      });
      return;
    }

    // Create the booking
    const booking = new Booking({
      userId: user._id,
      email: user.email,
      airline: data.airline || 'Unknown',
      confirmationNumber: data.confirmationNumber,
      flightNumber: data.flightNumber,
      origin: data.origin,
      destination: data.destination,
      departureDate: data.departureDate ? new Date(data.departureDate) : null,
      cabinClass: data.cabinClass || 'economy',
      passengers: data.passengers || 1,
      pricePaid: data.pricePaid || null,
      bookingType: 'cash',
      status: 'monitoring',
      planAtBooking: user.plan,
      dropThreshold: 10,
      nextCheckAt: new Date(Date.now() + 15 * 60 * 1000), // first check in 15 min
      parsedFrom: 'email',
      parseConfidence: confidence,
    });

    await booking.save();

    // Decrement per-trip plan
    if (user.plan === 'per_trip') {
      await User.findByIdAndUpdate(user._id, { $inc: { tripsRemaining: -1 } });
    }

    console.log(`[email-inbound] ✅ Booking created: ${booking._id}`);

    // Send confirmation email to user
    const missingNote = missingFields.length > 0
      ? `<p>⚠️ We couldn't detect: <strong>${missingFields.join(', ')}</strong>. <a href="https://tripreclaim.com/dashboard/">Update these in your dashboard</a>.</p>`
      : '';

    const priceNote = !data.pricePaid
      ? `<p>⚠️ We couldn't find your price paid. <a href="https://tripreclaim.com/dashboard/">Add it in your dashboard</a> so we can calculate your exact savings.</p>`
      : '';

    await resend.emails.send({
      from: 'TripReclaim <hello@tripreclaim.com>',
      to: user.email,
      subject: `✅ Now monitoring: ${data.airline || 'Your flight'} ${data.origin || ''}→${data.destination || ''}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
          <h2 style="color:#1d4ed8;">✅ Your flight is being monitored!</h2>
          <p>Hi ${user.name || 'there'}, we parsed your confirmation email and set up price monitoring automatically.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:8px;color:#64748b;">Airline</td><td style="padding:8px;font-weight:600;">${data.airline || '—'}</td></tr>
            <tr style="background:#f8fafc;"><td style="padding:8px;color:#64748b;">Route</td><td style="padding:8px;font-weight:600;">${data.origin || '?'} → ${data.destination || '?'}</td></tr>
            <tr><td style="padding:8px;color:#64748b;">Flight</td><td style="padding:8px;font-weight:600;">${data.flightNumber || '—'}</td></tr>
            <tr style="background:#f8fafc;"><td style="padding:8px;color:#64748b;">Departure</td><td style="padding:8px;font-weight:600;">${data.departureDate || '—'}</td></tr>
            <tr><td style="padding:8px;color:#64748b;">Cabin</td><td style="padding:8px;font-weight:600;">${data.cabinClass || 'Economy'}</td></tr>
            <tr style="background:#f8fafc;"><td style="padding:8px;color:#64748b;">Price Paid</td><td style="padding:8px;font-weight:600;">${data.pricePaid ? '$' + data.pricePaid.toFixed(2) : '—'}</td></tr>
            <tr><td style="padding:8px;color:#64748b;">Confidence</td><td style="padding:8px;font-weight:600;">${confidence}%</td></tr>
          </table>
          ${missingNote}
          ${priceNote}
          <p>We'll check prices every 15 minutes for the first hour, then hourly. You'll get an alert the moment we detect a drop.</p>
          <p><a href="https://tripreclaim.com/dashboard/" style="background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:8px;">View in Dashboard →</a></p>
          <p style="color:#94a3b8;font-size:0.85rem;margin-top:24px;">— The TripReclaim Team | <a href="https://tripreclaim.com" style="color:#94a3b8;">tripreclaim.com</a></p>
        </div>
      `
    });

  } catch (err) {
    console.error('[email-inbound] Error:', err.message);
    // res already sent — just log
  }
});

/**
 * Extract the email address of the user who forwarded the email.
 * When a user forwards an email, their address appears in the 'from' field
 * of the inbound webhook (they sent the forward from their email client).
 */
const extractForwarderEmail = (from, headers) => {
  if (!from) return null;
  // Extract email from "Name <email>" format
  const m = from.match(/<([^>]+)>/) || from.match(/([\w.+-]+@[\w.-]+\.[a-z]{2,})/i);
  return m ? m[1].toLowerCase() : null;
};

module.exports = router;
