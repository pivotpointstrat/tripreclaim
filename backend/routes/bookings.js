const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { sendWelcome } = require('../services/email');

const SUPPORTED_AIRLINES = [
  // Full airline list — kept loose, frontend validates
  'American Airlines', 'Delta Air Lines', 'United Airlines', 'Southwest Airlines',
  'JetBlue', 'Alaska Airlines', 'Spirit Airlines', 'Frontier Airlines',
  'Hawaiian Airlines', 'Sun Country Airlines', 'Allegiant Air',
  'Air France', 'KLM', 'Lufthansa', 'British Airways', 'Virgin Atlantic',
  'Swiss International Air Lines', 'Austrian Airlines', 'Brussels Airlines',
  'Finnair', 'Iberia', 'SAS Scandinavian Airlines', 'Turkish Airlines',
  'Aer Lingus', 'EasyJet', 'Ryanair', 'Wizz Air', 'TAP Air Portugal', 'LOT Polish Airlines',
  'Qatar Airways', 'Emirates', 'Etihad Airways', 'Air Arabia', 'flydubai', 'Saudia',
  'Singapore Airlines', 'Cathay Pacific', 'Japan Airlines', 'ANA All Nippon Airways',
  'Korean Air', 'Asiana Airlines', 'Air China', 'China Eastern', 'China Southern',
  'EVA Air', 'Thai Airways', 'Malaysia Airlines', 'Qantas', 'Air New Zealand',
  'Garuda Indonesia', 'Air Canada', 'WestJet', 'Aeromexico', 'LATAM Airlines',
  'Avianca', 'Copa Airlines', 'GOL Airlines', 'Azul Brazilian Airlines',
];

/**
 * GET /bookings
 * List all bookings for the authenticated user
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const bookings = await Booking.find({ userId: req.user._id })
      .select('-priceHistory')
      .sort({ createdAt: -1 })
      .lean();
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

/**
 * GET /bookings/:id
 * Get a single booking with full price history
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).lean();
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ booking });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

/**
 * POST /bookings
 * Submit a new booking for monitoring
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    // Check plan eligibility
    if (!user.plan || user.planStatus !== 'active') {
      return res.status(403).json({ error: 'Active plan required to add bookings' });
    }
    if (user.plan === 'per_trip' && user.tripsRemaining <= 0) {
      return res.status(403).json({ error: 'No trips remaining on your Per Trip plan. Please purchase another.' });
    }

    const {
      airline,
      origin,
      destination,
      departureDate,
      returnDate,
      isRoundTrip,
      cabinClass,
      passengers,
      pricePaid,
      dropThreshold,
      confirmationNumber,
    } = req.body;

    // Validation
    if (!airline || !origin || !destination || !departureDate || !pricePaid) {
      return res.status(400).json({ error: 'Required fields: airline, origin, destination, departureDate, pricePaid' });
    }
    if (!SUPPORTED_AIRLINES.includes(airline)) {
      return res.status(400).json({ error: `Unsupported airline. Supported: ${SUPPORTED_AIRLINES.join(', ')}` });
    }
    const depDate = new Date(departureDate);
    if (isNaN(depDate.getTime()) || depDate <= new Date()) {
      return res.status(400).json({ error: 'Departure date must be in the future' });
    }
    if (pricePaid <= 0 || pricePaid > 50000) {
      return res.status(400).json({ error: 'Invalid price paid' });
    }

    const booking = new Booking({
      userId: user._id,
      email: user.email,
      airline,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      departureDate: depDate,
      returnDate: returnDate ? new Date(returnDate) : null,
      isRoundTrip: !!isRoundTrip,
      cabinClass: cabinClass || 'economy',
      passengers: passengers || 1,
      pricePaid: parseFloat(pricePaid),
      dropThreshold: dropThreshold || 10,
      confirmationNumber: confirmationNumber || null,
      planAtBooking: user.plan,
    });

    await booking.save();

    // Decrement per_trip balance
    if (user.plan === 'per_trip') {
      await User.findByIdAndUpdate(user._id, { $inc: { tripsRemaining: -1 } });
    }

    // Send welcome/confirmation email
    try {
      await sendWelcome(user.email, booking);
    } catch (emailErr) {
      console.error('[bookings] Failed to send welcome email:', emailErr.message);
    }

    res.status(201).json({
      message: 'Booking submitted! We\'re now monitoring your flight.',
      booking,
    });
  } catch (err) {
    console.error('[bookings] Create error:', err.message);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

/**
 * PATCH /bookings/:id
 * Update a booking (pause/resume, change threshold)
 */
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { status, dropThreshold } = req.body;
    const allowed = {};
    if (status && ['active', 'paused'].includes(status)) allowed.status = status;
    if (dropThreshold && dropThreshold > 0) allowed.dropThreshold = dropThreshold;

    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      allowed,
      { new: true }
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ booking });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

/**
 * DELETE /bookings/:id
 * Remove a booking from monitoring
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const booking = await Booking.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ message: 'Booking removed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

module.exports = router;
