const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');
const Booking = require('../models/Booking');
const { parseConfirmationEmail } = require('../services/emailParser');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * POST /webhooks/email-inbound
 * Receives inbound email events from Resend.
 * Resend webhook payload contains only metadata + email_id.
 * We must call the Resend API separately to retrieve the email body.
 */
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Parse raw body
    const rawBody = req.body.toString();
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (e) {
      console.error('[email-inbound] Invalid JSON payload');
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Verify webhook signature if secret is configured
    if (process.env.RESEND_WEBHOOK_SECRET) {
      try {
        resend.webhooks.verify({
          payload: rawBody,
          headers: {
            id: req.headers['svix-id'],
            timestamp: req.headers['svix-timestamp'],
            signature: req.headers['svix-signature'],
          },
          webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
        });
      } catch (verifyErr) {
        console.error('[email-inbound] Webhook signature verification failed:', verifyErr.message);
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // Only handle email.received events
    if (event.type !== 'email.received') {
      return res.json({ received: true, skipped: true });
    }

    // Acknowledge immediately (Resend requires response within 10s)
    res.json({ received: true });

    // Process async after response
    setImmediate(() => processInboundEmail(event).catch(err =>
      console.error('[email-inbound] Processing error:', err.message)
    ));

  } catch (err) {
    console.error('[email-inbound] Outer error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Processes an inbound email event asynchronously.
 * Fetches the full email body from Resend API, parses it, and creates a booking.
 */
async function processInboundEmail(event) {
  const { email_id, from, to, subject } = event.data;

  console.log(`[email-inbound] Processing email_id=${email_id} from=${from} subject="${subject}"`);

  // Step 1: Fetch full email content from Resend API
  let emailContent = { text: '', html: '' };
  try {
    const response = await axios.get(
      `https://api.resend.com/received-emails/${email_id}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    emailContent = response.data || {};
    console.log(`[email-inbound] Retrieved email body (text: ${(emailContent.text || '').length} chars, html: ${(emailContent.html || '').length} chars)`);
  } catch (fetchErr) {
    console.error('[email-inbound] Failed to fetch email body:', fetchErr.message);
    // Continue with empty body — parser will report low confidence
  }

  // Step 2: Determine the forwarder's email address
  // When a user forwards an email, 'from' in the webhook is their address
  const forwarderEmail = extractEmailAddress(from);
  if (!forwarderEmail) {
    console.log('[email-inbound] Could not determine forwarder email — skipping');
    return;
  }

  // Step 3: Find TripReclaim account
  const user = await User.findOne({ email: forwarderEmail.toLowerCase() });
  if (!user) {
    console.log(`[email-inbound] No TripReclaim account for ${forwarderEmail}`);
    await resend.emails.send({
      from: 'TripReclaim <hello@tripreclaim.com>',
      to: forwarderEmail,
      subject: "We couldn't find your TripReclaim account",
      html: `
        <p>Hi there,</p>
        <p>We received your forwarded confirmation email but couldn't find a TripReclaim account linked to <strong>${forwarderEmail}</strong>.</p>
        <p>To use email monitoring, please <a href="https://tripreclaim.com">sign up for TripReclaim</a> first, then forward your confirmation email to track@tripreclaim.com.</p>
        <p>— The TripReclaim Team</p>
      `
    });
    return;
  }

  // Step 4: Parse the confirmation email
  const parseResult = parseConfirmationEmail({
    from,
    subject,
    text: emailContent.text || '',
    html: emailContent.html || ''
  });

  if (!parseResult.success) {
    console.log(`[email-inbound] Parse failed (confidence: ${parseResult.confidence}%):`, parseResult.missingFields);
    await resend.emails.send({
      from: 'TripReclaim <hello@tripreclaim.com>',
      to: user.email,
      subject: "We couldn't read your confirmation email",
      html: `
        <p>Hi ${user.name || 'there'},</p>
        <p>We received your forwarded email but had trouble extracting the flight details automatically.</p>
        <p><strong>Missing:</strong> ${parseResult.missingFields.join(', ')}</p>
        <p>Please <a href="https://tripreclaim.com/dashboard/">add your flight manually</a> — it only takes 30 seconds.</p>
        <p>— The TripReclaim Team</p>
      `
    });
    return;
  }

  const { data, confidence, missingFields } = parseResult;
  console.log(`[email-inbound] ✅ Parsed ${data.airline} booking (confidence: ${confidence}%):`, data);

  // Step 5: Check flight cap
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
        <p>We received your confirmation for ${data.airline || ''}${data.origin ? ' ' + data.origin + '→' + data.destination : ''} but your plan allows a maximum of <strong>${cap} simultaneous flights</strong>.</p>
        <p>You currently have <strong>${activeCount}</strong> flights being monitored.</p>
        <p><a href="https://tripreclaim.com/dashboard/">Upgrade your plan →</a></p>
        <p>— The TripReclaim Team</p>
      `
    });
    return;
  }

  // Step 6: Create the booking
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
    nextCheckAt: new Date(Date.now() + 15 * 60 * 1000),
    parsedFrom: 'email',
    parseConfidence: confidence,
  });

  await booking.save();

  if (user.plan === 'per_trip') {
    await User.findByIdAndUpdate(user._id, { $inc: { tripsRemaining: -1 } });
  }

  console.log(`[email-inbound] ✅ Booking created: ${booking._id}`);

  // Step 7: Confirmation email to user
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
}

/**
 * Extract email address from "Name <email>" or plain "email" format.
 */
const extractEmailAddress = (from) => {
  if (!from) return null;
  const m = from.match(/<([^>]+)>/) || from.match(/([\w.+-]+@[\w.-]+\.[a-z]{2,})/i);
  return m ? m[1].toLowerCase() : null;
};

module.exports = router;
