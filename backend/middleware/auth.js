const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware: verify JWT from Authorization header or cookie
 * Sets req.user if valid
 */
const requireAuth = async (req, res, next) => {
  try {
    let token = null;

    // Check Authorization header: Bearer <token>
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    // Fallback: check cookie
    if (!token && req.cookies && req.cookies.tr_token) {
      token = req.cookies.tr_token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).lean();

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please request a new login link.' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

/**
 * Generate a signed JWT for a user session
 */
const generateSessionToken = (userId) => {
  return jwt.sign(
    { userId: userId.toString() },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
};

/**
 * Generate a short-lived magic link token
 */
const generateMagicToken = (email) => {
  return jwt.sign(
    { email: email.toLowerCase(), type: 'magic' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.MAGIC_LINK_EXPIRY || '1h' }
  );
};

module.exports = { requireAuth, generateSessionToken, generateMagicToken };
