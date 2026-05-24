const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/leads — capture lead from calculator
router.post('/', async (req, res) => {
  try {
    const { email, origin, destination, departureDate, pricePaid } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    // Check if already a user
    const existingUser = await User.findOne({ email: email.toLowerCase() });

    // Send alert email
    const routeLabel = (origin && destination) ? `${origin} → ${destination}` : 'your route';
    const depLabel = departureDate ? new Date(departureDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'your departure date';
    const priceLabel = pricePaid ? `$${Number(pricePaid).toLocaleString()}` : 'your fare';

    await resend.emails.send({
      from: 'TripReclaim <hello@tripreclaim.com>',
      to: email,
      subject: `✅ Free 24-hour monitoring started — ${routeLabel}`,
      html: `
        <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
          <div style="background:linear-gradient(135deg,#0f172a,#1d4ed8);padding:32px;border-radius:16px 16px 0 0;text-align:center">
            <img src="https://tripreclaim.com/logos/logo.png" alt="TripReclaim" style="height:36px;margin-bottom:16px">
            <h1 style="color:#fff;font-size:1.4rem;margin:0;font-weight:800">✅ 24-hour free monitoring started</h1>
          </div>
          <div style="background:#fff;padding:32px;border:1px solid #e2e8f0;border-top:none">
            <p style="font-size:1rem;margin:0 0 20px">Hi there,</p>
            <p style="margin:0 0 24px;color:#475569">We're watching <strong>${routeLabel}</strong> on <strong>${depLabel}</strong> for the next 24 hours. If the price drops from your paid fare of <strong>${priceLabel}</strong>, we'll alert you instantly with step-by-step instructions to claim the difference.</p>

            <div style="background:#eff6ff;border-radius:12px;padding:20px;margin-bottom:24px">
              <p style="margin:0 0 8px;font-weight:700;font-size:0.9rem">⚡ What happens next:</p>
              <ul style="margin:0;padding-left:20px;color:#475569;font-size:0.9rem;line-height:1.8">
                <li>We check prices every 15 minutes in your first 24 hours</li>
                <li>If a drop is detected, you get an exact Claim Kit for your airline</li>
                <li>The kit includes a pre-written refund email — just copy and send</li>
              </ul>
            </div>

            <div style="background:#dcfce7;border-radius:12px;padding:20px;margin-bottom:24px">
              <p style="margin:0;font-size:0.9rem;color:#166534"><strong>💡 DOT 24-Hour Rule:</strong> If you booked within the last 24 hours and your flight is 7+ days away, you're entitled to a FULL CASH REFUND if you cancel — no questions asked. <a href="https://tripreclaim.com/blog/dot-24-hour-flight-cancellation-rule/" style="color:#166534">Learn more →</a></p>
            </div>

            <p style="margin:0 0 24px;color:#475569;font-size:0.9rem">Your free 24-hour watch expires tomorrow. To keep monitoring this flight until departure — and protect every trip you book — continue for just <strong>$2.99</strong>:</p>

            <div style="text-align:center;margin-bottom:24px">
              <a href="https://tripreclaim.com/#pricing" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;text-decoration:none;font-size:0.95rem">Continue Monitoring — $2.99/trip →</a>
            </div>

            <p style="margin:0;color:#94a3b8;font-size:0.8rem;text-align:center">TripReclaim · <a href="https://tripreclaim.com" style="color:#94a3b8">tripreclaim.com</a> · <a href="https://tripreclaim.com/privacy/" style="color:#94a3b8">Privacy</a></p>
          </div>
        </div>
      `
    });

    // Save lead to MongoDB if not existing user
    if (!existingUser) {
      try {
        const lead = new User({
          email: email.toLowerCase(),
          plan: 'lead',
          createdAt: new Date(),
          metadata: { origin, destination, departureDate, pricePaid, source: 'calculator' }
        });
        await lead.save();
      } catch (e) {
        // Non-critical — email already sent
        console.log('Lead save note:', e.message);
      }
    }

    res.json({ success: true, message: 'Monitoring started — check your email' });
  } catch (err) {
    console.error('Lead capture error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

module.exports = router;
