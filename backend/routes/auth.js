const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { generateSessionToken, generateMagicToken } = require('../middleware/auth');
const { sendMagicLink } = require('../services/email');

/**
 * POST /auth/magic-link
 * Request a new magic link (for returning users who need to log back in)
 */
router.post('/magic-link', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal if user exists
      return res.json({ message: 'If an account exists, a login link has been sent.' });
    }

    const token = generateMagicToken(email);
    const magicUrl = `${process.env.FRONTEND_URL}/dashboard?token=${token}`;
    await sendMagicLink(email, magicUrl, user.plan);

    res.json({ message: 'Login link sent to your email.' });
  } catch (err) {
    console.error('[auth] Magic link error:', err.message);
    res.status(500).json({ error: 'Failed to send login link' });
  }
});

/**
 * GET /auth/verify?token=...
 * Verify a magic link token and return a session JWT
 */
router.get('/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type !== 'magic') {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    const email = decoded.email.toLowerCase();
    const user = await User.findOneAndUpdate(
      { email },
      { lastLoginAt: new Date() },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Issue a 30-day session token
    const sessionToken = generateSessionToken(user._id);

    res.json({
      token: sessionToken,
      user: {
        email: user.email,
        plan: user.plan,
        planStatus: user.planStatus,
        tripsRemaining: user.tripsRemaining,
      },
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Link expired. Please request a new one.' });
    }
    return res.status(401).json({ error: 'Invalid or expired link' });
  }
});

/**
 * GET /auth/me
 * Return current user info (requires session token)
 */
router.get('/me', require('../middleware/auth').requireAuth, (req, res) => {
  const { email, plan, planStatus, tripsRemaining, createdAt } = req.user;
  res.json({ email, plan, planStatus, tripsRemaining, createdAt });
});

module.exports = router;
