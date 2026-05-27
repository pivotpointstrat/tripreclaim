const express = require('express');
const router = express.Router();
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');
const { Resend } = require('resend');
const { requireAuth } = require('../middleware/auth');
const resend = new Resend(process.env.RESEND_API_KEY);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'seyla@pivotpointstrat.com';
const SUPPORT_FROM = 'TripReclaim Support <support@tripreclaim.com>';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://tripreclaim.com').replace(/\/$/, '');

// ── Escalation detection ────────────────────────────────────────────────────
const ESCALATION_KEYWORDS = [
  'fraud', 'chargeback', 'dispute', 'ftc', 'lawsuit', 'attorney', 'lawyer',
  'bbb', 'scam', 'refund demand', 'legal action', 'credit card dispute', 'bank dispute'
];

function needsEscalation(category, message) {
  const lower = message.toLowerCase();
  if (ESCALATION_KEYWORDS.some(k => lower.includes(k))) return 'Legal/dispute keyword detected';
  if (category === 'billing' && lower.includes('charged twice')) return 'Duplicate charge claim';
  if (category === 'billing' && lower.includes('unauthorized')) return 'Unauthorized charge claim';
  return null;
}

// ── Smart agent responses by category ──────────────────────────────────────
function buildAgentResponse(category, ticket, user) {
  const magicLinkSection = `<div style="text-align:center;margin:20px 0">
    <a href="${FRONTEND_URL}/dashboard/" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:10px;font-weight:700;text-decoration:none">Open My Dashboard →</a>
    <p style="font-size:0.8rem;color:#94a3b8;margin-top:8px">Use your email to request a new sign-in link if needed</p>
  </div>`;

  const responses = {
    account_access: {
      subject: `Re: [Ticket #${ticket.ticketNumber}] Account access — here's how to get in`,
      body: `<p>Thanks for reaching out! Account access issues are easy to fix.</p>
        <p><strong>To access your TripReclaim dashboard:</strong></p>
        <ol style="line-height:1.9;color:#475569">
          <li>Go to <a href="${FRONTEND_URL}/dashboard/">tripreclaim.com/dashboard</a></li>
          <li>Enter the email address you used when you signed up or purchased</li>
          <li>Click <strong>"Send Magic Link"</strong></li>
          <li>Check your inbox (and spam folder) for the sign-in link</li>
          <li>Click the link — it's valid for 1 hour</li>
        </ol>
        <p><strong>Common fixes:</strong></p>
        <ul style="color:#475569;line-height:1.9">
          <li>Check spam/junk folder for the magic link email</li>
          <li>Make sure you're using the same email you paid with</li>
          <li>Magic links expire after 1 hour — just request a new one</li>
        </ul>
        ${magicLinkSection}
        <p>If you still can't get in after trying these steps, reply to this email with the email address you used and we'll sort it out right away.</p>`,
      autoResolved: true,
    },
    billing: {
      subject: `Re: [Ticket #${ticket.ticketNumber}] Billing question — what we can do for you`,
      body: `<p>Thanks for getting in touch about your billing. Here's what you can do right now:</p>
        <div style="background:#f0fdf4;border-radius:10px;padding:16px;margin:16px 0">
          <p style="font-weight:700;color:#15803d;margin:0 0 8px">✅ Manage your subscription yourself — instantly:</p>
          <ul style="color:#475569;line-height:1.9;margin:0">
            <li><strong>Cancel anytime</strong> — no questions asked, effective immediately</li>
            <li><strong>Upgrade or downgrade</strong> your plan</li>
            <li><strong>View invoices</strong> and payment history</li>
            <li><strong>Update payment method</strong></li>
          </ul>
        </div>
        ${magicLinkSection}
        <p>Once in your dashboard → click <strong>Account tab</strong> → <strong>"Manage Billing →"</strong> to access the Stripe billing portal.</p>
        <p style="background:#fff7ed;border-radius:8px;padding:12px;color:#9a3412">If you were charged in error or have a billing dispute, please reply directly to this email and a team member will review it within 4 hours.</p>`,
      autoResolved: false, // billing needs human follow-up if not resolved
    },
    monitoring: {
      subject: `Re: [Ticket #${ticket.ticketNumber}] Monitoring question — let's fix it`,
      body: `<p>Thanks for reaching out about your flight monitoring. Here are the most common fixes:</p>
        <div style="background:#eff6ff;border-radius:10px;padding:16px;margin:16px 0">
          <p style="font-weight:700;color:#1d4ed8;margin:0 0 12px">🔍 Common monitoring issues:</p>
          <p style="font-weight:600;color:#1e40af">"My alert didn't fire"</p>
          <ul style="color:#475569;line-height:1.9;margin:0 0 12px">
            <li>Check that monitoring is <strong>Active</strong> (not Paused) on your booking card</li>
            <li>We only alert on the same airline outside the 24-hour window — the price must drop on <em>your exact airline</em></li>
            <li>Prices may not have dropped below your threshold yet</li>
            <li>Check your spam folder for the alert email</li>
          </ul>
          <p style="font-weight:600;color:#1e40af">"Wrong price is showing"</p>
          <ul style="color:#475569;line-height:1.9;margin:0 0 12px">
            <li>We monitor the route using real-time data — prices fluctuate constantly</li>
            <li>The price shown is the lowest currently available on your airline for that route/date</li>
          </ul>
          <p style="font-weight:600;color:#1e40af">"My flight isn't being monitored"</p>
          <ul style="color:#475569;line-height:1.9;margin:0">
            <li>Make sure the flight was added to your dashboard with all required details</li>
            <li>Per-trip plan monitors 1 flight, Monthly monitors up to 5, Annual up to 15</li>
          </ul>
        </div>
        ${magicLinkSection}
        <p>If none of these apply, please reply with your <strong>booking confirmation number</strong> and <strong>airline</strong> and we'll investigate directly.</p>`,
      autoResolved: true,
    },
    claim_help: {
      subject: `Re: [Ticket #${ticket.ticketNumber}] Claim help — step-by-step guide`,
      body: `<p>Great news — you may be entitled to a price adjustment or travel credit. Here's exactly how to claim it:</p>
        <div style="background:#f0fdf4;border-radius:10px;padding:16px;margin:16px 0">
          <p style="font-weight:700;color:#15803d;margin:0 0 12px">📋 How to claim a price drop refund:</p>
          <p style="font-weight:600;color:#166534">Step 1 — Check your claim window</p>
          <ul style="color:#475569;line-height:1.9;margin:0 0 12px">
            <li><strong>Within 24 hours of booking:</strong> Full cash refund under the DOT rule — cancel and rebook at the lower price</li>
            <li><strong>After 24 hours:</strong> Travel credit for the fare difference (most airlines) — contact your airline directly</li>
          </ul>
          <p style="font-weight:600;color:#166534">Step 2 — Contact your airline</p>
          <ul style="color:#475569;line-height:1.9;margin:0 0 12px">
            <li>Call the airline or use their app/website</li>
            <li>Say: <em>"I'd like to request a price adjustment — I see the fare has dropped since I booked"</em></li>
            <li>Have your confirmation number ready</li>
          </ul>
          <p style="font-weight:600;color:#166534">Step 3 — Get your Claim Kit from TripReclaim</p>
          <ul style="color:#475569;line-height:1.9;margin:0">
            <li>Log into your dashboard and click the <strong>"Get Claim Kit"</strong> button on your flight card</li>
            <li>It contains the exact script to use with your airline, plus airline-specific policy details</li>
          </ul>
        </div>
        <p>View our full policy guides at <a href="${FRONTEND_URL}/policies/">tripreclaim.com/policies</a> — each airline has its own step-by-step page.</p>
        ${magicLinkSection}`,
      autoResolved: true,
    },
    general: {
      subject: `Re: [Ticket #${ticket.ticketNumber}] We received your message`,
      body: `<p>Thanks for getting in touch! We've received your message and will get back to you within <strong>4 hours</strong>.</p>
        <p>In the meantime, these resources answer most questions instantly:</p>
        <ul style="line-height:1.9;color:#475569">
          <li><a href="${FRONTEND_URL}/support/#faq">Support Center & FAQ</a> — answers to the most common questions</li>
          <li><a href="${FRONTEND_URL}/policies/">Airline Policy Guides</a> — claim instructions per airline</li>
          <li><a href="${FRONTEND_URL}/dashboard/">Your Dashboard</a> — manage bookings, plan, and billing</li>
        </ul>
        <p>We'll follow up at <strong>${ticket.email}</strong> shortly.</p>`,
      autoResolved: false,
    },
  };

  return responses[category] || responses.general;
}

// ── Email builder ───────────────────────────────────────────────────────────
function wrapEmail(title, bodyHtml, ticketNumber) {
  return `
    <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <div style="background:linear-gradient(135deg,#0f172a,#1d4ed8);padding:28px 32px;border-radius:16px 16px 0 0">
        <img src="https://tripreclaim.com/logos/logo.png" alt="TripReclaim" style="height:32px;margin-bottom:12px;display:block">
        <h1 style="color:#fff;font-size:1.2rem;margin:0;font-weight:700">${title}</h1>
      </div>
      <div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:none">
        ${bodyHtml}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
        <p style="font-size:0.8rem;color:#94a3b8;margin:0">Ticket #${ticketNumber} · <a href="https://tripreclaim.com" style="color:#94a3b8">TripReclaim</a> · <a href="https://tripreclaim.com/support/" style="color:#94a3b8">Support Center</a></p>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/support — create ticket + smart agent response
// ══════════════════════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  try {
    const { email, name, category, subject, message } = req.body;
    if (!email || !subject || !message) {
      return res.status(400).json({ error: 'email, subject, and message are required' });
    }

    // Link to existing user if found
    const user = await User.findOne({ email: email.toLowerCase() }).lean();

    // Create ticket
    const ticket = new SupportTicket({
      email: email.toLowerCase(),
      name: name || null,
      category: category || 'general',
      subject,
      message,
      userId: user?._id || null,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Check escalation
    const escalationReason = needsEscalation(category, message);
    if (escalationReason) {
      ticket.escalated = true;
      ticket.escalatedAt = new Date();
      ticket.escalationReason = escalationReason;
      ticket.status = 'escalated';
    }

    await ticket.save();

    // Build smart agent response
    const agentResp = buildAgentResponse(category || 'general', ticket, user);

    // Send auto-response to user
    await resend.emails.send({
      from: SUPPORT_FROM,
      to: ticket.email,
      subject: agentResp.subject,
      html: wrapEmail(agentResp.subject.replace(/^Re: /, ''), agentResp.body, ticket.ticketNumber),
      reply_to: ADMIN_EMAIL,
    });

    // Update ticket with agent response
    ticket.agentResponse = agentResp.body;
    ticket.agentRespondedAt = new Date();
    ticket.status = agentResp.autoResolved ? 'agent_replied' : ticket.status === 'escalated' ? 'escalated' : 'agent_replied';
    ticket.autoResolved = agentResp.autoResolved || false;
    await ticket.save();

    // Notify admin if escalated
    if (ticket.escalated) {
      await resend.emails.send({
        from: SUPPORT_FROM,
        to: ADMIN_EMAIL,
        subject: `🚨 [ESCALATE] Ticket #${ticket.ticketNumber} — ${ticket.category}: ${ticket.subject}`,
        html: wrapEmail(
          `🚨 Escalation Required — Ticket #${ticket.ticketNumber}`,
          `<p><strong>From:</strong> ${ticket.email} ${ticket.name ? `(${ticket.name})` : ''}</p>
           <p><strong>Category:</strong> ${ticket.category}</p>
           <p><strong>Escalation Reason:</strong> <span style="color:#b91c1c;font-weight:700">${ticket.escalationReason}</span></p>
           <p><strong>Message:</strong></p>
           <blockquote style="border-left:3px solid #e2e8f0;padding-left:16px;color:#475569;margin:0">${ticket.message}</blockquote>
           <p style="margin-top:16px"><a href="mailto:${ticket.email}" style="background:#dc2626;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Reply to ${ticket.email} →</a></p>`,
          ticket.ticketNumber
        ),
      });
    }

    res.json({
      success: true,
      ticketNumber: ticket.ticketNumber,
      autoResolved: ticket.autoResolved,
      escalated: ticket.escalated,
      message: 'Ticket created and response sent',
    });
  } catch (err) {
    console.error('[support] Create ticket error:', err);
    res.status(500).json({ error: 'Failed to create support ticket' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/support/mine — authenticated user's own tickets
// ══════════════════════════════════════════════════════════════════════════════
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ email: req.user.email })
      .sort({ createdAt: -1 })
      .select('ticketNumber category subject status createdAt agentRespondedAt autoResolved escalated')
      .limit(20)
      .lean();
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load tickets' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/support/admin — all tickets (admin only — verified by admin email)
// ══════════════════════════════════════════════════════════════════════════════
router.get('/admin', requireAuth, async (req, res) => {
  if (req.user.email !== ADMIN_EMAIL && req.user.email !== 'tessa@pivotpointstrat.com') {
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const { status, page = 1 } = req.query;
    const filter = status ? { status } : {};
    const tickets = await SupportTicket.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .skip((page - 1) * 50)
      .lean();
    const total = await SupportTicket.countDocuments(filter);
    res.json({ tickets, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load tickets' });
  }
});

module.exports = router;
