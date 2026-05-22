require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const connectDB = require('./db');

const app = express();

// ── Security ──
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'https://tripreclaim.com',
      'https://www.tripreclaim.com',
      'http://localhost:3001',
      'http://localhost:3000',
    ];
    // Also allow the configured FRONTEND_URL (strip trailing slash)
    const envUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    if (envUrl) allowed.push(envUrl);
    // Allow requests with no origin (e.g. curl, mobile apps, Stripe webhooks)
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));

// ── Rate limiting ──
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use(limiter);

// ── Body parsing ──
// IMPORTANT: Stripe webhook route needs raw body — mount BEFORE json middleware
app.use('/webhooks', require('./routes/twilio-webhook'));
app.use('/webhooks/email-inbound', require('./routes/email-inbound'));
app.use('/webhook', require('./routes/webhook'));

// JSON body parser for all other routes
app.use(express.json());

// ── Routes ──
app.use('/auth', require('./routes/auth'));
app.use('/bookings', require('./routes/bookings'));
app.use('/lookup', require('./routes/lookup'));
const policyRoutes = require('./routes/policy');
app.use('/policy', policyRoutes);
app.use('/billing', require('./routes/billing'));

// ── Health check ──
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TripReclaim API',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
  });
});

// ── 404 handler ──
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──
const PORT = process.env.PORT || 3000;

const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`✅ TripReclaim API running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Frontend:    ${process.env.FRONTEND_URL}`);
  });
};

start();

module.exports = app;
