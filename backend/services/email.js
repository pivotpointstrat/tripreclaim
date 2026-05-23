const { Resend } = require('resend');
const twilio = require('twilio');
const { getPolicyForAirline } = require('./policyAgent');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = `${process.env.EMAIL_FROM_NAME || 'TripReclaim'} <${process.env.EMAIL_FROM || 'hello@tripreclaim.com'}>`;

// Map airline display names → IATA codes for policy lookup
const AIRLINE_TO_CODE = {
  'American Airlines': 'AA',
  'Delta Air Lines':   'DL',
  'United Airlines':   'UA',
  'Southwest Airlines': 'WN',
  'JetBlue':           'B6',
  'Alaska Airlines':   'AS',
  'Lufthansa':         'LH',
  'British Airways':   'BA',
  'Qatar Airways':     'QR',
};

/**
 * Send magic link / login email
 */
const sendMagicLink = async (email, magicUrl, plan) => {
  const planLabel = { per_trip: 'Per Trip', monthly: 'Monthly', annual: 'Annual' }[plan] || plan;
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Your TripReclaim login link',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
        <h1 style="color:#1d4ed8;margin-bottom:8px;">✈️ TripReclaim</h1>
        <h2 style="color:#0f172a;">Your dashboard is one click away</h2>
        <p style="color:#475569;">Thanks for signing up for the <strong>${planLabel}</strong> plan. Click the button below to access your dashboard and start monitoring your first flight.</p>
        <a href="${magicUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Open My Dashboard →</a>
        <p style="color:#94a3b8;font-size:13px;">This link expires in 1 hour. If you didn't sign up for TripReclaim, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">TripReclaim · <a href="https://tripreclaim.com" style="color:#94a3b8;">tripreclaim.com</a></p>
      </div>
    `,
  });
};

/**
 * Send welcome email after first booking is submitted
 */
const sendWelcome = async (email, booking) => {
  const route = `${booking.origin} → ${booking.destination}`;
  const date = new Date(booking.departureDate).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `✅ We're monitoring your flight: ${route}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
        <h1 style="color:#1d4ed8;">✈️ TripReclaim</h1>
        <h2 style="color:#0f172a;">Your flight is being monitored</h2>
        <div style="background:#f0f9ff;border-radius:12px;padding:20px;margin:20px 0;">
          <p style="margin:0 0 8px 0;"><strong>Route:</strong> ${route}</p>
          <p style="margin:0 0 8px 0;"><strong>Airline:</strong> ${booking.airline}</p>
          <p style="margin:0 0 8px 0;"><strong>Date:</strong> ${date}</p>
          <p style="margin:0;"><strong>Price paid:</strong> $${booking.pricePaid.toFixed(2)}</p>
        </div>
        <p style="color:#475569;">We'll check this route regularly and alert you the moment the price drops by $${booking.dropThreshold} or more. You'll receive instructions on how to claim your refund directly from the airline.</p>
        <p style="color:#475569;">Sit back — we've got it from here. 🙌</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">TripReclaim · <a href="https://tripreclaim.com" style="color:#94a3b8;">tripreclaim.com</a></p>
      </div>
    `,
  });
};

/**
 * Build the policy claim-kit HTML block.
 * Returns an HTML string with numbered steps, claim URL, and credit expiry.
 */
const buildClaimKitHtml = (policy, booking) => {
  if (!policy) return '';
  const p = policy.policies || {};

  // Credit expiry: booking.createdAt + 1 year (fallback to policy text)
  let creditExpiryStr = p.creditExpiry || '';
  if (booking.createdAt) {
    const expiry = new Date(booking.createdAt);
    expiry.setFullYear(expiry.getFullYear() + 1);
    creditExpiryStr = expiry.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  const steps = (p.claimSteps || []).map((step, i) => `<li style="margin:6px 0;">${step}</li>`).join('');
  const stepsHtml = steps
    ? `<ol style="margin:8px 0 12px 0;padding-left:20px;color:#1e3a5f;">${steps}</ol>`
    : '';

  const claimBtn = p.claimUrl
    ? `<a href="${p.claimUrl}" style="display:inline-block;margin-top:8px;padding:10px 20px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Claim Now →</a>`
    : '';

  const expiryNote = creditExpiryStr
    ? `<p style="margin:10px 0 0 0;font-size:13px;color:#475569;">⏰ Credit valid until: <strong>${creditExpiryStr}</strong></p>`
    : '';

  const phoneNote = p.claimPhone
    ? `<p style="margin:6px 0 0 0;font-size:13px;color:#475569;">📞 Phone: <strong>${p.claimPhone}</strong></p>`
    : '';

  return `
    <div style="border-left:4px solid #1d4ed8;padding:16px 20px;margin:20px 0;background:#eff6ff;border-radius:0 8px 8px 0;">
      <h3 style="margin:0 0 10px 0;color:#1e3a5f;font-size:16px;">How to Claim Your Credit — ${policy.airline}</h3>
      ${stepsHtml}
      ${claimBtn}
      ${expiryNote}
      ${phoneNote}
    </div>
  `;
};

/**
 * Build the "24-hour FULL CASH REFUND" banner.
 * Shown when the booking was made within the last 24 hours.
 */
const buildTwentyFourHourBanner = (booking) => {
  const hoursSinceBooking = (Date.now() - new Date(booking.createdAt).getTime()) / (1000 * 60 * 60);
  if (hoursSinceBooking > 24) return '';
  return `
    <div style="background:#fef9c3;border:2px solid #ca8a04;border-radius:10px;padding:16px 20px;margin:16px 0;">
      <p style="margin:0;font-size:15px;font-weight:700;color:#854d0e;">⚡ FULL CASH REFUND AVAILABLE</p>
      <p style="margin:6px 0 0 0;font-size:14px;color:#713f12;">Your booking is within the 24-hour DOT cancellation window. You're entitled to a <strong>full cash refund to your original payment method</strong> — no credits, no hassle. Cancel now and rebook at the lower price.</p>
    </div>
  `;
};

/**
 * Send price drop alert
 *
 * @param {string} email
 * @param {object} booking
 * @param {number} currentPrice
 * @param {object} opts - { netSavings, rawDrop, notWorthClaiming }
 */
const sendPriceDropAlert = async (email, booking, currentPrice, opts = {}) => {
  const { netSavings = null, rawDrop = null, notWorthClaiming = false, googleFlightsUrl = null, evidenceUrl = null, within24h = false, skyscannerUrl = null } = opts;
  const route = `${booking.origin} → ${booking.destination}`;
  const drop = rawDrop !== null ? rawDrop : booking.pricePaid - currentPrice;
  const net  = netSavings !== null ? netSavings : drop;
  const date = new Date(booking.departureDate).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });

  // Look up airline policy from DB
  const airlineCode = AIRLINE_TO_CODE[booking.airline] || booking.airline.toUpperCase().slice(0, 2);
  let policy = null;
  try {
    policy = await getPolicyForAirline(airlineCode);
  } catch (e) {
    console.warn('[email] Could not load policy for', booking.airline, e.message);
  }

  const claimKit   = buildClaimKitHtml(policy, booking);
  const banner24h  = buildTwentyFourHourBanner(booking);

  // ── Miles booking: adapted messaging ──
  const isMiles = booking.bookingType !== 'cash' && booking.milesPaid;
  const program = booking.milesProgram || 'miles';

  // ── Subject line ──
  let subject;
  if (notWorthClaiming) {
    subject = `ℹ️ Price dropped on ${route} — but not worth claiming (fee exceeds savings)`;
  } else if (isMiles) {
    subject = `💰 Miles drop alert! ${route} award ticket dropped in price`;
  } else {
    subject = `💰 Price drop alert! ${route} is now $${currentPrice} (you paid $${booking.pricePaid})`;
  }

  // ── Price table ──
  const priceTableHtml = isMiles
    ? `
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#64748b;">Miles paid</td><td style="text-align:right;font-weight:600;">${booking.milesPaid.toLocaleString()} ${program}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Current price</td><td style="text-align:right;font-weight:600;color:#22c55e;">$${currentPrice.toFixed(2)}</td></tr>
      </table>`
    : `
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#64748b;">You paid</td><td style="text-align:right;font-weight:600;">$${booking.pricePaid.toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Current price</td><td style="text-align:right;font-weight:600;color:#22c55e;">$${currentPrice.toFixed(2)}</td></tr>
        ${ rawDrop !== null && netSavings !== null && rawDrop !== netSavings ? `
        <tr><td style="padding:6px 0;color:#64748b;">Cancellation fee</td><td style="text-align:right;font-weight:600;color:#ef4444;">−$${(rawDrop - netSavings).toFixed(2)}</td></tr>` : '' }
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:8px 0;font-weight:700;">Your ${notWorthClaiming ? 'gross drop' : 'net refund'}</td>
          <td style="text-align:right;font-weight:800;color:${notWorthClaiming ? '#ef4444' : '#16a34a'};font-size:18px;">$${(notWorthClaiming ? drop : net).toFixed(2)}</td>
        </tr>
      </table>`;

  // ── Hero section ──
  const heroHtml = notWorthClaiming
    ? `
      <div style="background:#fef2f2;border:2px solid #fca5a5;border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
        <p style="color:#991b1b;font-size:14px;font-weight:600;margin:0 0 8px 0;">ℹ️ PRICE DROPPED — BUT NOT WORTH CLAIMING</p>
        <p style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 4px 0;">Drop: $${drop.toFixed(2)} — Fee: $${(drop - net).toFixed(2)}</p>
        <p style="color:#475569;margin:0;">${route} · ${date}</p>
      </div>`
    : `
      <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
        <p style="color:#15803d;font-size:14px;font-weight:600;margin:0 0 8px 0;">💰 PRICE DROP DETECTED</p>
        <p style="font-size:32px;font-weight:800;color:#0f172a;margin:0 0 4px 0;">Save $${net.toFixed(2)}</p>
        <p style="color:#475569;margin:0;">${route} · ${date}</p>
      </div>`;

  // ── Not worth claiming explanation ──
  const notWorthHtml = notWorthClaiming
    ? `
      <div style="background:#fff7ed;border-left:4px solid #f97316;padding:14px 18px;margin:16px 0;border-radius:0 8px 8px 0;">
        <p style="margin:0;font-weight:600;color:#c2410c;">Why we're not recommending you claim this drop:</p>
        <p style="margin:8px 0 0 0;color:#475569;font-size:14px;">
          The price dropped <strong>$${drop.toFixed(2)}</strong>, but your fare type (${booking.cabinClass.replace('_', ' ')}) has a cancellation fee of
          <strong>$${(drop - net).toFixed(2)}</strong>. Claiming would cost you more than you'd save.
          We'll keep monitoring — if the price drops further and exceeds the fee, we'll alert you again.
        </p>
      </div>`
    : '';

  // ── Fallback refund guide (only if no DB policy available) ──
  const fallbackGuide = !policy
    ? `
      <h3 style="color:#0f172a;">How to claim your refund from ${booking.airline}:</h3>
      <div style="background:#f8fafc;border-radius:8px;padding:16px;color:#334155;line-height:1.7;">${getRefundGuide(booking.airline)}</div>`
    : '';

  await resend.emails.send({
    from: FROM,
    to: email,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
        <h1 style="color:#1d4ed8;">✈️ TripReclaim</h1>

        ${heroHtml}
        ${banner24h}
        ${notWorthHtml}

        <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">
          ${priceTableHtml}
        </div>

        ${claimKit}
        ${fallbackGuide}

        ${ (googleFlightsUrl || skyscannerUrl) ? `
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 18px;margin:16px 0;">
          ${ within24h ? `
            <p style="margin:0 0 10px 0;font-size:14px;font-weight:600;color:#0369a1;">⚡ You're within the 24h window — book the lower fare and get a full cash refund:</p>
          ` : `
            <p style="margin:0 0 10px 0;font-size:14px;font-weight:600;color:#0369a1;">🔍 Verify current price and request a price adjustment from ${booking.airline}:</p>
          ` }
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            ${ googleFlightsUrl ? `<a href="${googleFlightsUrl}" target="_blank" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">🔍 Google Flights →</a>` : '' }
            ${ skyscannerUrl ? `<a href="${skyscannerUrl}" target="_blank" style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">✈️ Skyscanner →</a>` : '' }
          </div>
        </div>` : '' }
        ${ evidenceUrl ? `
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px 18px;margin:16px 0;">
          <p style="margin:0;font-size:13px;color:#0369a1;">
            📄 <strong>Price Evidence Report</strong> — timestamped proof of this price drop for your records and any airline claim forms.
            <br><a href="${evidenceUrl}" style="color:#1d4ed8;font-weight:600;">View Evidence Report →</a>
          </p>
        </div>` : '' }
        <p style="color:#94a3b8;font-size:13px;margin-top:24px;">Act quickly — airline prices can change within hours. We'll keep monitoring until your travel date.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">TripReclaim · <a href="https://tripreclaim.com" style="color:#94a3b8;">tripreclaim.com</a> · <a href="https://tripreclaim.com/unsubscribe" style="color:#94a3b8;">Unsubscribe</a></p>
      </div>
    `,
  });
};

/**
 * Send travel credit expiry reminder.
 * Triggered by cron when creditExpiryDate is approaching.
 *
 * @param {string} email
 * @param {object} booking  - full booking document (with creditAmount, creditExpiryDate, airline)
 * @param {number} daysLeft - days until credit expires
 */
const sendCreditExpiryReminder = async (email, booking, daysLeft) => {
  const expiryDate = new Date(booking.creditExpiryDate).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const amount = booking.creditAmount ? `$${booking.creditAmount.toFixed(2)}` : 'your';
  const route  = `${booking.origin} → ${booking.destination}`;
  const urgencyColor = daysLeft <= 7 ? '#dc2626' : '#d97706';
  const urgencyLabel = daysLeft <= 7 ? '🚨 URGENT' : '⏰ Reminder';

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `${urgencyLabel}: Your ${amount} ${booking.airline} travel credit expires in ${daysLeft} days`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
        <h1 style="color:#1d4ed8;">✈️ TripReclaim</h1>
        <div style="background:#fff7ed;border:2px solid ${urgencyColor};border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
          <p style="color:${urgencyColor};font-size:14px;font-weight:600;margin:0 0 8px 0;">${urgencyLabel}: CREDIT EXPIRING SOON</p>
          <p style="font-size:28px;font-weight:800;color:#0f172a;margin:0 0 4px 0;">${amount} ${booking.airline} credit</p>
          <p style="color:#475569;margin:0;">Expires <strong>${expiryDate}</strong> (${daysLeft} days)</p>
        </div>
        <p style="color:#475569;">You claimed a travel credit for your <strong>${route}</strong> price drop. Don't let it go to waste — use it before it expires!</p>
        <p style="color:#475569;">Book any ${booking.airline} flight using your credit before it's gone.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">TripReclaim · <a href="https://tripreclaim.com" style="color:#94a3b8;">tripreclaim.com</a></p>
      </div>
    `,
  });
};

/**
 * Send policy change notification to affected subscribers.
 *
 * @param {string} email
 * @param {string} airlineName
 * @param {string[]} affectedBookingRoutes  - e.g. ['JFK → LAX', 'ORD → MIA']
 */
const sendPolicyChangeAlert = async (email, airlineName, affectedBookingRoutes) => {
  const routeList = affectedBookingRoutes
    .map(r => `<li style="margin:4px 0;">${r}</li>`)
    .join('');

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `📋 ${airlineName} updated their refund policy — affects your monitored flights`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
        <h1 style="color:#1d4ed8;">✈️ TripReclaim</h1>
        <h2 style="color:#0f172a;">Policy Update Detected</h2>
        <p style="color:#475569;"><strong>${airlineName}</strong> appears to have updated their refund or cancellation policy. This may affect how you claim price-drop credits on the following monitored flights:</p>
        <ul style="color:#334155;">${routeList}</ul>
        <p style="color:#475569;">We've updated our records. Your next price drop alert will include the latest claim instructions. You may also want to review the current policy directly on ${airlineName}'s website.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">TripReclaim · <a href="https://tripreclaim.com" style="color:#94a3b8;">tripreclaim.com</a></p>
      </div>
    `,
  });
};

/**
 * Airline-specific refund guides (static fallback when DB policy unavailable)
 */
const getRefundGuide = (airline) => {
  const guides = {
    'Delta': `<ol><li>Log into <strong>delta.com</strong> and go to <em>My Trips</em>.</li><li>Select your booking and click <strong>"Change or Cancel."</strong></li><li>Choose <strong>"Change Flight"</strong> (not cancel) to rebook at the lower fare.</li><li>If the price difference is more than $25, you may also call Delta at <strong>1-800-221-1212</strong> and request a fare adjustment.</li></ol>`,
    'Delta Air Lines': `<ol><li>Log into <strong>delta.com</strong> and go to <em>My Trips</em>.</li><li>Select your booking and click <strong>"Change or Cancel."</strong></li><li>Choose <strong>"Change Flight"</strong> to rebook at the lower fare.</li><li>Call Delta at <strong>1-800-221-1212</strong> for assistance.</li></ol>`,
    'American Airlines': `<ol><li>Visit <strong>aa.com</strong>, log in, and find your booking under <em>My Trips</em>.</li><li>Click <strong>"Change trip"</strong> to rebook at the lower price.</li><li>The fare difference will be issued as an <strong>AAdvantage travel credit</strong>.</li><li>Call American at <strong>1-800-433-7300</strong> for 24-hour adjustments.</li></ol>`,
    'United': `<ol><li>Go to <strong>united.com</strong> → <em>My Trips</em> and select your booking.</li><li>Click <strong>"Change flight"</strong> and select the lower-priced option.</li><li>United will issue the difference as a <strong>travel credit (ETC)</strong>.</li><li>Call United at <strong>1-800-864-8331</strong> for same-day adjustments.</li></ol>`,
    'United Airlines': `<ol><li>Go to <strong>united.com</strong> → <em>My Trips</em>.</li><li>Click <strong>"Change flight"</strong> and select the lower-priced option.</li><li>United issues the difference as an ETC.</li><li>Call <strong>1-800-864-8331</strong> for help.</li></ol>`,
    'Southwest': `<ol><li>Southwest has a <strong>flexible fare policy</strong> — rebook at the lower price any time.</li><li>Go to <strong>southwest.com</strong> → <em>Manage Reservations</em>.</li><li>Cancel and rebook at the new lower price. The difference is issued as travel funds.</li></ol>`,
    'Southwest Airlines': `<ol><li>Go to <strong>southwest.com</strong> → <em>Manage Reservations</em>.</li><li>Rebook at the lower price — difference issued as travel funds or points.</li></ol>`,
    'JetBlue': `<ol><li>Log into <strong>jetblue.com</strong> and go to <em>Manage Trips</em>.</li><li>Select your flight and click <strong>"Change Flight."</strong></li><li>The price difference will be issued as a <strong>JetBlue travel credit.</strong></li></ol>`,
    'Alaska Airlines': `<ol><li>Visit <strong>alaskaair.com</strong> → <em>Manage My Reservation</em>.</li><li>Click <strong>"Change Flight"</strong> and select the lower fare.</li><li>Alaska will apply the difference as a <strong>credit certificate</strong>.</li></ol>`,
    'Lufthansa': `<ol><li>Log into <strong>lufthansa.com</strong> and access <em>My Bookings</em>.</li><li>Request a fare adjustment via customer service at <strong>1-800-645-3880</strong>.</li></ol>`,
    'British Airways': `<ol><li>Visit <strong>britishairways.com</strong> → <em>Manage My Booking</em>.</li><li>For flexible tickets, change online; otherwise call <strong>1-800-247-9297</strong>.</li></ol>`,
    'Qatar Airways': `<ol><li>Log into <strong>qatarairways.com</strong> → <em>Manage Booking</em>.</li><li>Select <strong>"Change Flight"</strong> or call <strong>1-877-777-2827</strong>.</li></ol>`,
  };
  return guides[airline] || `<p>Contact ${airline} customer service directly with your booking reference and current lower fare screenshot to request a price adjustment.</p>`;
};


// ─── Twilio SMS ───────────────────────────────────────────────────────────────
const getTwilioClient = () => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
};

const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER || '+18885165777';

/**
 * Send a raw SMS message.
 * Silently skips if Twilio credentials are not configured.
 */
const sendSmsAlert = async (to, message) => {
  if (!to) return;
  // Normalise phone number — ensure E.164 format
  const phone = to.startsWith('+') ? to : `+1${to.replace(/\D/g, '')}`;
  const client = getTwilioClient();
  if (!client) {
    console.warn('[sms] Twilio not configured — skipping SMS to', phone);
    return;
  }
  try {
    const msg = await client.messages.create({ from: TWILIO_FROM, to: phone, body: message });
    console.log(`[sms] Sent to ${phone} — SID: ${msg.sid}`);
  } catch (err) {
    console.error(`[sms] Failed to send to ${phone}:`, err.message);
  }
};

/**
 * Send a price-drop SMS alert.
 * Crafts a short, actionable message appropriate for the alert type.
 */
const sendSmsPriceDropAlert = async (phone, booking, currentPrice, opts = {}) => {
  const { netSavings = null, notWorthClaiming = false } = opts;
  const route = `${booking.origin}→${booking.destination}`;
  const net = netSavings !== null ? netSavings : (booking.pricePaid - currentPrice);
  const hoursSinceBooking = (Date.now() - new Date(booking.createdAt).getTime()) / (1000 * 60 * 60);
  const in24hWindow = hoursSinceBooking < 24;
  const dashUrl = 'https://tripreclaim.com/dashboard/';

  let body;
  if (notWorthClaiming) {
    body = `ℹ️ TripReclaim: ${booking.airline} ${route} dropped but fees exceed savings — not worth claiming. We’ll keep watching. ${dashUrl}`;
  } else if (in24hWindow) {
    const hoursLeft = Math.max(0, 24 - hoursSinceBooking).toFixed(0);
    body = `⚡ TripReclaim: ${booking.airline} ${route} dropped $${net.toFixed(0)}! FULL CASH REFUND available — ${hoursLeft}h left. Claim now: ${dashUrl}`;
  } else {
    body = `✈️ TripReclaim: ${booking.airline} ${route} dropped $${net.toFixed(0)} — travel credit available. See your Claim Kit: ${dashUrl}`;
  }

  await sendSmsAlert(phone, body);
};

/**
 * Onboarding Email — Day 0 (Welcome after purchase)
 */
const sendOnboardingDay0 = async (email, user) => {
  const planLabel = { per_trip: 'Per Trip ($1.99)', monthly: 'Monthly ($4.99/mo)', annual: 'Annual ($39/yr)' }[user.plan] || user.plan;
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: '✈️ Welcome to TripReclaim — here\'s how to save on your next flight',
    html: `
      <div style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:32px;color:#0f172a;">
        <h1 style="color:#1d4ed8;">✈️ TripReclaim</h1>
        <h2>Welcome${user.name ? ', ' + user.name : ''}! You\'re protected.</h2>
        <p style="color:#475569;">You\'re now on the <strong>${planLabel}</strong> plan. Every flight you add to TripReclaim is monitored 24/7 — the moment the price drops, we\'ll tell you exactly how to get your money back.</p>
        <div style="background:#f0f9ff;border-radius:12px;padding:20px;margin:24px 0;">
          <p style="margin:0 0 10px 0;"><strong>🚀 3 steps to start saving:</strong></p>
          <p style="margin:0 0 8px 0;">1️⃣ <strong>Add your booking</strong> — Go to your dashboard and enter your flight details</p>
          <p style="margin:0 0 8px 0;">2️⃣ <strong>We monitor 24/7</strong> — We check prices every 15–60 minutes depending on urgency</p>
          <p style="margin:0;">3️⃣ <strong>Get your refund</strong> — When prices drop, we send a complete Claim Kit with step-by-step instructions</p>
        </div>
        <div style="background:#fff7ed;border-radius:12px;padding:20px;margin:24px 0;border-left:4px solid #f97316;">
          <p style="margin:0 0 8px 0;"><strong>⚡ Pro tip: The 24-hour rule</strong></p>
          <p style="margin:0;color:#374151;">Just booked? Add your flight to TripReclaim <em>right now</em>. In the first 24 hours after booking, DOT regulations give you the right to cancel for a <strong>full cash refund</strong> if prices drop — not just a credit. We monitor every 15 minutes during this window.</p>
        </div>
        <a href="https://tripreclaim.com/dashboard/" style="display:inline-block;margin:8px 0 24px;padding:14px 28px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Add Your First Flight →</a>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">TripReclaim · <a href="https://tripreclaim.com" style="color:#94a3b8;">tripreclaim.com</a> · <a href="https://tripreclaim.com/dashboard/" style="color:#94a3b8;">Manage account</a></p>
      </div>
    `,
  });
};

/**
 * Onboarding Email — Day 3 (Example alert preview)
 */
const sendOnboardingDay3 = async (email, user) => {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: '📬 Here\'s exactly what a TripReclaim price drop alert looks like',
    html: `
      <div style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:32px;color:#0f172a;">
        <h1 style="color:#1d4ed8;">✈️ TripReclaim</h1>
        <h2>This is what a price drop alert looks like</h2>
        <p style="color:#475569;">When TripReclaim detects a price drop on one of your flights, here\'s the email you\'ll receive — complete with everything you need to claim your refund:</p>

        <!-- Mock alert email -->
        <div style="border:2px solid #1d4ed8;border-radius:12px;padding:24px;margin:24px 0;background:#f8fafc;">
          <p style="color:#64748b;font-size:12px;margin:0 0 12px 0;">EXAMPLE ALERT EMAIL ↓</p>
          <h3 style="color:#16a34a;margin:0 0 4px 0;">💰 Price dropped $127 on your flight</h3>
          <p style="color:#374151;margin:0 0 16px 0;">AA 202 · JFK → LAX · July 15</p>
          <div style="background:#fff;border-radius:8px;padding:16px;margin-bottom:16px;">
            <p style="margin:0 0 6px 0;">You paid: <strong>$489</strong></p>
            <p style="margin:0 0 6px 0;">Current price: <strong style="color:#16a34a;">$342</strong></p>
            <p style="margin:0;">Net savings: <strong style="color:#16a34a;">$127</strong> (after any fees)</p>
          </div>
          <p style="font-size:0.95rem;margin:0 0 8px 0;"><strong>How to claim your American Airlines credit:</strong></p>
          <p style="font-size:0.9rem;color:#374151;margin:0 0 6px 0;">1. Go to aa.com → My Trips → Find booking GHABCD</p>
          <p style="font-size:0.9rem;color:#374151;margin:0 0 6px 0;">2. Select \'Change Trip\'</p>
          <p style="font-size:0.9rem;color:#374151;margin:0 0 6px 0;">3. Re-select same flight — $127 credit applied automatically</p>
          <p style="font-size:0.9rem;color:#374151;margin:0;">4. Credit valid until: July 2027</p>
        </div>

        <p style="color:#475569;">Every alert includes step-by-step claim instructions, a pre-written refund email you can forward to the airline, and the exact credit expiry date.</p>
        ${!user.onboardingComplete ? '<p style="color:#475569;"><strong>Haven\'t added a flight yet?</strong> You can add any upcoming booking — even flights you booked weeks ago.</p>' : ''}
        <a href="https://tripreclaim.com/dashboard/" style="display:inline-block;margin:8px 0 24px;padding:14px 28px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">View My Dashboard →</a>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">TripReclaim · <a href="https://tripreclaim.com" style="color:#94a3b8;">tripreclaim.com</a> · <a href="https://tripreclaim.com/dashboard/" style="color:#94a3b8;">Manage account</a></p>
      </div>
    `,
  });
};

/**
 * Onboarding Email — Day 7 (24-hour DOT rule education + re-engagement)
 */
const sendOnboardingDay7 = async (email, user) => {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: '🚨 The 24-hour refund rule most travelers don\'t know about',
    html: `
      <div style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:32px;color:#0f172a;">
        <h1 style="color:#1d4ed8;">✈️ TripReclaim</h1>
        <h2>The rule airlines don\'t advertise</h2>
        <div style="background:#fff7ed;border-left:4px solid #f97316;border-radius:8px;padding:20px;margin:24px 0;">
          <p style="margin:0;font-size:1.05rem;"><strong>Under DOT regulations</strong>, any flight originating to or from the US can be cancelled for a <strong>full cash refund</strong> — back to your card — within 24 hours of booking, as long as the flight departs 7+ days away.</p>
        </div>
        <p style="color:#475569;">This means: if you book a flight today and the price drops in the next 24 hours, you can cancel for a complete refund and rebook at the lower price. Airlines are legally required to honor this.</p>
        <p style="color:#475569;"><strong>The catch?</strong> Airlines change prices up to 35 times per day. The first 24 hours after booking is the most volatile — and the most valuable — window.</p>
        <div style="background:#f0f9ff;border-radius:12px;padding:20px;margin:24px 0;">
          <p style="margin:0 0 8px 0;"><strong>How TripReclaim handles this:</strong></p>
          <p style="margin:0 0 6px 0;">⚡ Checks every <strong>15 minutes</strong> in the first hour after booking</p>
          <p style="margin:0 0 6px 0;">🔍 Every <strong>30 minutes</strong> through hour 6</p>
          <p style="margin:0 0 6px 0;">📊 Every <strong>hour</strong> through the 24-hour window</p>
          <p style="margin:0;">If a price drops — even by $20 — we alert you <em>immediately</em> with your remaining refund window countdown.</p>
        </div>
        <p style="color:#475569;">The next time you book a flight, add it to TripReclaim the moment you confirm your booking. That\'s when it matters most.</p>
        <a href="https://tripreclaim.com/dashboard/" style="display:inline-block;margin:8px 0 24px;padding:14px 28px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Open My Dashboard →</a>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">TripReclaim · <a href="https://tripreclaim.com" style="color:#94a3b8;">tripreclaim.com</a> · You\'re receiving this because you subscribed to TripReclaim. <a href="https://tripreclaim.com/dashboard/" style="color:#94a3b8;">Manage preferences</a></p>
      </div>
    `,
  });
};

module.exports = { sendMagicLink, sendWelcome, sendPriceDropAlert, sendCreditExpiryReminder, sendPolicyChangeAlert, sendSmsAlert, sendSmsPriceDropAlert, sendOnboardingDay0, sendOnboardingDay3, sendOnboardingDay7 };
