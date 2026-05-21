const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = `${process.env.EMAIL_FROM_NAME || 'TripReclaim'} <${process.env.EMAIL_FROM || 'hello@tripreclaim.com'}>`;

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
 * Send price drop alert
 */
const sendPriceDropAlert = async (email, booking, currentPrice) => {
  const route = `${booking.origin} → ${booking.destination}`;
  const drop = booking.pricePaid - currentPrice;
  const date = new Date(booking.departureDate).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
  const refundGuide = getRefundGuide(booking.airline);

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `💰 Price drop alert! ${route} is now $${currentPrice} (you paid $${booking.pricePaid})`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
        <h1 style="color:#1d4ed8;">✈️ TripReclaim</h1>
        <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
          <p style="color:#15803d;font-size:14px;font-weight:600;margin:0 0 8px 0;">💰 PRICE DROP DETECTED</p>
          <p style="font-size:32px;font-weight:800;color:#0f172a;margin:0 0 4px 0;">Save $${drop.toFixed(2)}</p>
          <p style="color:#475569;margin:0;">${route} · ${date}</p>
        </div>
        <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:6px 0;color:#64748b;">You paid</td><td style="text-align:right;font-weight:600;">$${booking.pricePaid.toFixed(2)}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Current price</td><td style="text-align:right;font-weight:600;color:#22c55e;">$${currentPrice.toFixed(2)}</td></tr>
            <tr style="border-top:1px solid #e2e8f0;"><td style="padding:8px 0;font-weight:700;">Your refund</td><td style="text-align:right;font-weight:800;color:#16a34a;font-size:18px;">$${drop.toFixed(2)}</td></tr>
          </table>
        </div>
        <h3 style="color:#0f172a;">How to claim your refund from ${booking.airline}:</h3>
        <div style="background:#f8fafc;border-radius:8px;padding:16px;color:#334155;line-height:1.7;">${refundGuide}</div>
        <p style="color:#94a3b8;font-size:13px;margin-top:24px;">Act quickly — airline prices can change within hours. We'll keep monitoring until your travel date.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">TripReclaim · <a href="https://tripreclaim.com" style="color:#94a3b8;">tripreclaim.com</a> · <a href="https://tripreclaim.com/unsubscribe" style="color:#94a3b8;">Unsubscribe</a></p>
      </div>
    `,
  });
};

/**
 * Airline-specific refund guides
 */
const getRefundGuide = (airline) => {
  const guides = {
    'Delta': `<ol><li>Log into <strong>delta.com</strong> and go to <em>My Trips</em>.</li><li>Select your booking and click <strong>"Change or Cancel."</strong></li><li>Choose <strong>"Change Flight"</strong> (not cancel) to rebook at the lower fare.</li><li>If the price difference is more than $25, you may also call Delta at <strong>1-800-221-1212</strong> and request a fare adjustment.</li><li>Delta's <strong>Best Price Guarantee</strong> may apply — check delta.com/best-price-guarantee for eligibility.</li></ol>`,
    'American Airlines': `<ol><li>Visit <strong>aa.com</strong>, log in, and find your booking under <em>My Trips</em>.</li><li>Click <strong>"Change trip"</strong> to rebook at the lower price.</li><li>The fare difference will be issued as an <strong>AAdvantage travel credit</strong>.</li><li>For immediate cash refunds, call American at <strong>1-800-433-7300</strong> and request a fare adjustment within 24 hours of the original booking if applicable.</li></ol>`,
    'United': `<ol><li>Go to <strong>united.com</strong> → <em>My Trips</em> and select your booking.</li><li>Click <strong>"Change flight"</strong> and select the lower-priced option for the same date.</li><li>United will issue the difference as a <strong>travel credit (ETC)</strong>.</li><li>Call United at <strong>1-800-864-8331</strong> for same-day booking adjustments if within 24 hours.</li></ol>`,
    'Southwest': `<ol><li>Southwest has a <strong>flexible fare policy</strong> — you can rebook at the lower price any time.</li><li>Go to <strong>southwest.com</strong> → <em>Manage Reservations</em>.</li><li>Cancel and rebook at the new lower price. <strong>The difference is issued as travel funds.</strong></li><li>Travel funds never expire for active Rapid Rewards members.</li></ol>`,
    'JetBlue': `<ol><li>Log into <strong>jetblue.com</strong> and go to <em>Manage Trips</em>.</li><li>Select your flight and click <strong>"Change Flight."</strong></li><li>The price difference will be issued as a <strong>JetBlue travel credit.</strong></li><li>For Blue Flex or Mint fares, you may be eligible for a full refund to your original payment method.</li></ol>`,
    'Alaska Airlines': `<ol><li>Visit <strong>alaskaair.com</strong> → <em>Manage My Reservation</em>.</li><li>Click <strong>"Change Flight"</strong> and select the lower fare.</li><li>Alaska will apply the difference as a <strong>credit certificate</strong>.</li><li>Saver fares are non-changeable — check your fare type first.</li></ol>`,
    'Lufthansa': `<ol><li>Log into <strong>lufthansa.com</strong> and access <em>My Bookings</em>.</li><li>Request a fare adjustment through their customer service at <strong>1-800-645-3880</strong>.</li><li>Eligible tickets can be rebooked; fare difference issued as credit or to original card depending on fare class.</li></ol>`,
    'British Airways': `<ol><li>Visit <strong>britishairways.com</strong> → <em>Manage My Booking</em>.</li><li>For flexible tickets, change to the new lower fare directly online.</li><li>Call British Airways at <strong>1-800-247-9297</strong> for fare adjustments on non-flexible tickets.</li><li>Avios members: check if the lower fare offers a better value in Avios.</li></ol>`,
    'Qatar Airways': `<ol><li>Log into <strong>qatarairways.com</strong> → <em>Manage Booking</em>.</li><li>Select <strong>"Change Flight"</strong> to rebook at the lower price.</li><li>Fare difference credited based on ticket conditions.</li><li>Call Qatar Airways at <strong>1-877-777-2827</strong> for direct fare adjustment requests.</li></ol>`,
  };
  return guides[airline] || `<p>Contact ${airline} customer service directly with your booking reference and current lower fare screenshot to request a price adjustment or rebooking at the lower rate.</p>`;
};

module.exports = { sendMagicLink, sendWelcome, sendPriceDropAlert };
