const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');
const Booking = require('../models/Booking');
const { parseConfirmationEmail } = require('../services/emailParser');
const { runOcrOnEmail } = require('../services/imageOcr');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * POST /webhooks/email-inbound
 * Receives inbound email events from Resend.
 * Resend webhook payload contains only metadata + email_id.
 * We fetch the full email body via the Resend received-emails API.
 */
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const rawBody = req.body.toString();
    console.log('[email-inbound] Raw payload (first 300):', rawBody.substring(0, 300));

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (e) {
      console.error('[email-inbound] Invalid JSON payload');
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Only verify signature if Svix headers are actually present
    // (Resend inbound email webhooks may not include Svix headers)
    const svixId = req.headers['svix-id'];
    const svixTimestamp = req.headers['svix-timestamp'];
    const svixSignature = req.headers['svix-signature'];
    const hasSvixHeaders = svixId && svixTimestamp && svixSignature;

    if (process.env.RESEND_WEBHOOK_SECRET && hasSvixHeaders) {
      try {
        resend.webhooks.verify({
          payload: rawBody,
          headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
          webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
        });
        console.log('[email-inbound] Signature verified ✅');
      } catch (verifyErr) {
        console.error('[email-inbound] Signature verification failed:', verifyErr.message);
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } else if (!hasSvixHeaders) {
      console.log('[email-inbound] No Svix headers — skipping signature verification (inbound email)');
    }

    console.log('[email-inbound] Event type:', event.type);

    // Only handle email.received events
    if (event.type !== 'email.received') {
      console.log('[email-inbound] Skipping non-inbound event:', event.type);
      return res.json({ received: true, skipped: true });
    }

    // Acknowledge immediately (Resend requires response within 10s)
    res.json({ received: true });

    // Process async after response
    setImmediate(() => processInboundEmail(event).catch(err =>
      console.error('[email-inbound] Processing error:', err.message, err.stack)
    ));

  } catch (err) {
    console.error('[email-inbound] Outer error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  }
});

async function processInboundEmail(event) {
  const data = event.data || event; // handle both wrapped and unwrapped payloads
  const email_id = data.email_id || data.id;
  const from = data.from || data.sender;
  const subject = data.subject || '';
  const to = data.to || data.recipient || [];

  console.log(`[email-inbound] Processing email_id=${email_id} from=${from} to=${JSON.stringify(to)} subject="${subject}"`);

  if (!email_id) {
    console.error('[email-inbound] No email_id in payload — cannot fetch body');
    return;
  }

  // Step 1: Fetch full email content from Resend received-emails API
  let emailContent = { text: '', html: '' };
  try {
    const response = await axios.get(
      `https://api.resend.com/v1/received-emails/${email_id}`,
      {
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
        timeout: 15000
      }
    );
    emailContent = response.data || {};
    console.log(`[email-inbound] Email body fetched — text: ${(emailContent.text || '').length} chars, html: ${(emailContent.html || '').length} chars`);
  } catch (fetchErr) {
    // Try alternate endpoint path
    try {
      const response = await axios.get(
        `https://api.resend.com/received-emails/${email_id}`,
        {
          headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
          timeout: 15000
        }
      );
      emailContent = response.data || {};
      console.log(`[email-inbound] Email body fetched (alt endpoint) — text: ${(emailContent.text || '').length} chars`);
    } catch (fetchErr2) {
      console.error('[email-inbound] Failed to fetch email body:', fetchErr2.response?.data || fetchErr2.message);
    }
  }

  // Step 1.5: OCR detection — if email looks like a screenshot, try to extract text
  let isScreenshot = false;
  try {
    const ocrResult = await runOcrOnEmail(emailContent.text || '', emailContent.html || '');
    isScreenshot = ocrResult.isScreenshot;
    if (ocrResult.success) {
      console.log(`[email-inbound] OCR succeeded — appending ${ocrResult.ocrText.length} chars to text`);
      emailContent.text = (emailContent.text || '') + '\n\n' + ocrResult.ocrText;
    } else if (ocrResult.isScreenshot) {
      console.log(`[email-inbound] Screenshot detected but OCR got no useful text (${ocrResult.imageCount} image(s) found)`);
    }
  } catch (ocrErr) {
    console.warn('[email-inbound] OCR step failed (non-fatal):', ocrErr.message);
  }


  // Step 2: Determine forwarder's email address
  const forwarderEmail = extractEmailAddress(from);
  if (!forwarderEmail) {
    console.log('[email-inbound] Could not extract email from from field:', from);
    return;
  }
  console.log('[email-inbound] Forwarder email:', forwarderEmail);

  // Step 3: Find TripReclaim account
  const user = await User.findOne({ email: forwarderEmail.toLowerCase() });
  if (!user) {
    console.log(`[email-inbound] No TripReclaim account for ${forwarderEmail}`);
    try {
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
    } catch (e) { console.error('[email-inbound] Failed to send no-account email:', e.message); }
    return;
  }

  // Step 4: Parse the confirmation email
  const parseResult = parseConfirmationEmail({
    from, subject,
    text: emailContent.text || '',
    html: emailContent.html || ''
  });

  console.log(`[email-inbound] Parse result — confidence: ${parseResult.confidence}%, success: ${parseResult.success}`);
  if (!parseResult.success) {
    console.log('[email-inbound] Missing fields:', parseResult.missingFields);
    try {
      await resend.emails.send({
        from: 'TripReclaim <hello@tripreclaim.com>',
        to: user.email,
        subject: "We couldn't read your confirmation email",
        html: `
          <p>Hi ${user.name || 'there'},</p>
          <p>We received your forwarded email but had trouble extracting the flight details automatically.</p>
          <p><strong>Missing:</strong> ${parseResult.missingFields.join(', ')}</p>
          <p>Please <a href="https://tripreclaim.com/dashboard/?method=manual">add your flight manually</a> — it only takes 30 seconds.</p>
          <p>— The TripReclaim Team</p>
        `
      });
    } catch (e) { console.error('[email-inbound] Failed to send parse-fail email:', e.message); }
    // Screenshot-specific message
    if (isScreenshot) {
      try {
        await resend.emails.send({
          from: 'TripReclaim <hello@tripreclaim.com>',
          to: user.email,
          subject: 'Heads up — we received a screenshot, not a confirmation email',
          html: `
            <p>Hi ${user.name || 'there'},</p>
            <p>It looks like you forwarded a <strong>screenshot</strong> of your booking instead of the original confirmation email.</p>
            <p>Our parser reads the text content of confirmation emails — it can't read images or screenshots.</p>
            <p><strong>To fix this:</strong></p>
            <ol>
              <li>Open the <strong>original booking confirmation email</strong> from your airline (check your inbox for an email from the airline directly)</li>
              <li>Forward that email to <a href="mailto:track@tripreclaim.com">track@tripreclaim.com</a></li>
            </ol>
            <p>Or, <a href="https://tripreclaim.com/dashboard/?method=manual" style="color:#1d4ed8;">enter your flight details manually</a> — it only takes 30 seconds.</p>
            <p>— The TripReclaim Team</p>
          `
        });
        return;
      } catch (e) { console.error('[email-inbound] Failed to send screenshot email:', e.message); }
    }
    return;
  }

  const { data: parsed, confidence, missingFields } = parseResult;
  console.log(`[email-inbound] ✅ Parsed ${parsed.airline} booking (confidence: ${confidence}%):`, parsed);

  // Step 5: Check flight cap (status: 'active' matches Booking model enum)
  const planCaps = { per_trip: 1, monthly: 5, annual: 15 };
  const cap = planCaps[user.plan] || 1;
  const activeCount = await Booking.countDocuments({ userId: user._id, status: 'active' });

  if (activeCount >= cap) {
    console.log(`[email-inbound] Plan cap reached for ${user.email} (${activeCount}/${cap})`);
    try {
      await resend.emails.send({
        from: 'TripReclaim <hello@tripreclaim.com>',
        to: user.email,
        subject: 'Flight monitoring limit reached',
        html: `
          <p>Hi ${user.name || 'there'},</p>
          <p>We received your confirmation but your plan allows a maximum of <strong>${cap} simultaneous flights</strong>. You currently have <strong>${activeCount}</strong>.</p>
          <p><a href="https://tripreclaim.com/dashboard/?method=manual">Upgrade your plan →</a></p>
          <p>— The TripReclaim Team</p>
        `
      });
    } catch (e) { console.error('[email-inbound] Failed to send cap email:', e.message); }
    return;
  }

  // Step 6: Create the booking
  const booking = new Booking({
    userId: user._id,
    email: user.email,
    airline: parsed.airline || 'Unknown',
    confirmationNumber: parsed.confirmationNumber,
    flightNumber: parsed.flightNumber,
    origin: parsed.origin,
    destination: parsed.destination,
    departureDate: parsed.departureDate ? new Date(parsed.departureDate) : null,
    cabinClass: parsed.cabinClass || 'economy',
    passengers: parsed.passengers || 1,
    pricePaid: parsed.pricePaid || null,
    bookingType: 'cash',
    status: 'active',
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

  // Step 7: Confirmation email
  const missingNote = missingFields.length > 0
    ? `<p>⚠️ Couldn't detect: <strong>${missingFields.join(', ')}</strong>. <a href="https://tripreclaim.com/dashboard/?method=manual">Update in dashboard</a>.</p>`
    : '';
  const priceNote = !parsed.pricePaid
    ? `<p>⚠️ Price paid not found. <a href="https://tripreclaim.com/dashboard/?method=manual">Add it in your dashboard</a> so we can calculate exact savings.</p>`
    : '';

  try {
    await resend.emails.send({
      from: 'TripReclaim <hello@tripreclaim.com>',
      to: user.email,
      subject: `✅ Now monitoring: ${parsed.airline || 'Your flight'} ${parsed.origin || ''}→${parsed.destination || ''}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
          <h2 style="color:#1d4ed8;">✅ Your flight is being monitored!</h2>
          <p>Hi ${user.name || 'there'}, we parsed your confirmation email and set up price monitoring automatically.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:8px;color:#64748b;">Airline</td><td style="padding:8px;font-weight:600;">${parsed.airline || '—'}</td></tr>
            <tr style="background:#f8fafc;"><td style="padding:8px;color:#64748b;">Route</td><td style="padding:8px;font-weight:600;">${parsed.origin || '?'} → ${parsed.destination || '?'}</td></tr>
            <tr><td style="padding:8px;color:#64748b;">Flight</td><td style="padding:8px;font-weight:600;">${parsed.flightNumber || '—'}</td></tr>
            <tr style="background:#f8fafc;"><td style="padding:8px;color:#64748b;">Departure</td><td style="padding:8px;font-weight:600;">${parsed.departureDate || '—'}</td></tr>
            <tr><td style="padding:8px;color:#64748b;">Cabin</td><td style="padding:8px;font-weight:600;">${parsed.cabinClass || 'Economy'}</td></tr>
            <tr style="background:#f8fafc;"><td style="padding:8px;color:#64748b;">Price Paid</td><td style="padding:8px;font-weight:600;">${parsed.pricePaid ? '$' + Number(parsed.pricePaid).toFixed(2) : '—'}</td></tr>
            <tr><td style="padding:8px;color:#64748b;">Confidence</td><td style="padding:8px;font-weight:600;">${confidence}%</td></tr>
          </table>
          ${missingNote}${priceNote}
          <p>We'll check prices every 15 minutes. You'll get an alert the moment we detect a drop.</p>
          <p><a href="https://tripreclaim.com/dashboard/?method=manual" style="background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">View in Dashboard →</a></p>
          <p style="color:#94a3b8;font-size:0.85rem;">— TripReclaim | <a href="https://tripreclaim.com" style="color:#94a3b8;">tripreclaim.com</a></p>
        </div>
      `
    });
    console.log(`[email-inbound] ✅ Confirmation email sent to ${user.email}`);
  } catch (e) { console.error('[email-inbound] Failed to send confirmation email:', e.message); }
}

const extractEmailAddress = (from) => {
  if (!from) return null;
  const m = from.match(/<([^>]+)>/) || from.match(/([\w.+-]+@[\w.-]+\.[a-z]{2,})/i);
  return m ? m[1].toLowerCase() : null;
};

module.exports = router;
