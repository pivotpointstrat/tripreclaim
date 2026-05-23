const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const AirlinePolicy = require('../models/AirlinePolicy');
const { sendWelcome } = require('../services/email');
const { upsertContact } = require('../services/ghl');

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

    // Enforce simultaneous flight monitoring caps by plan
    const planCaps = { per_trip: 1, monthly: 5, annual: 15 };
    const cap = planCaps[user.plan] || 1;
    const activeCount = await Booking.countDocuments({
      userId: user._id,
      status: 'monitoring'
    });
    if (activeCount >= cap) {
      const upgradeTo = user.plan === 'per_trip' ? 'monthly' : 'annual';
      return res.status(403).json({
        error: `Flight monitoring limit reached`,
        code: 'FLIGHT_CAP_REACHED',
        current: activeCount,
        cap,
        plan: user.plan,
        upgradeTo
      });
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
      flightNumber,
      matchMode,
      monitoringPrefs,
      purchasedAt,
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
      flightNumber: flightNumber || null,
      purchasedAt: purchasedAt ? new Date(purchasedAt) : null,
      matchMode: matchMode || 'exact',
      monitoringPrefs: monitoringPrefs || {},
      planAtBooking: user.plan,
    });

    await booking.save();

    // Sync booking to GHL CRM (non-fatal)
    try {
      await upsertContact({ email: user.email, name: user.name || '', plan: user.plan,
        extraTags: [`route:${booking.origin}-${booking.destination}`, `airline:${booking.airline.toLowerCase().replace(/\s+/g, '-')}`],
        note: `Booking added: ${booking.airline} ${booking.origin}→${booking.destination} on ${booking.departureDate ? booking.departureDate.toISOString().split('T')[0] : 'unknown'}, paid $${booking.pricePaid}` });
    } catch (ghlErr) {
      console.error('[bookings] GHL sync failed:', ghlErr.message);
    }

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
/**
 * PATCH /bookings/:id/claim-credit
 * Record that the user claimed a travel credit for a price-drop refund.
 * Body: { creditAmount, creditExpiryDate }
 * Sets: creditClaimed=true, creditAmount, creditExpiryDate, creditClaimedAt=now
 */
router.patch('/:id/claim-credit', requireAuth, async (req, res) => {
  try {
    const { creditAmount, creditExpiryDate } = req.body;

    if (!creditAmount || creditAmount <= 0) {
      return res.status(400).json({ error: 'creditAmount must be a positive number' });
    }

    const update = {
      creditClaimed:    true,
      creditClaimedAt:  new Date(),
      creditAmount:     parseFloat(creditAmount),
    };

    if (creditExpiryDate) {
      const expiry = new Date(creditExpiryDate);
      if (isNaN(expiry.getTime())) {
        return res.status(400).json({ error: 'Invalid creditExpiryDate' });
      }
      update.creditExpiryDate = expiry;
    } else {
      // Default: 1 year from now
      const defaultExpiry = new Date();
      defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 1);
      update.creditExpiryDate = defaultExpiry;
    }

    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      update,
      { new: true }
    );

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    res.json({
      message: 'Credit claim recorded. We\'ll remind you before it expires.',
      booking,
    });
  } catch (err) {
    console.error('[bookings] claim-credit error:', err.message);
    res.status(500).json({ error: 'Failed to record credit claim' });
  }
});

/**
 * GET /bookings/:id/claim-email
 * Generate a complete, ready-to-send refund request email for a price-drop claim.
 * Returns { subject, body, claimUrl, claimPhone }
 */
router.get('/:id/claim-email', requireAuth, async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).lean();
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // Fetch airline policy — try IATA code extracted from flightNumber, then airline name
    let policy = null;
    // Derive IATA code from flightNumber (e.g. "AA 202" -> "AA") or airline name lookup
    const airlineCodeMatch = booking.flightNumber
      ? booking.flightNumber.trim().match(/^([A-Z]{2,3})/i)
      : null;
    if (airlineCodeMatch) {
      policy = await AirlinePolicy.findOne({
        code: airlineCodeMatch[1].toUpperCase(),
      }).lean();
    }
    if (!policy) {
      policy = await AirlinePolicy.findOne({
        airline: { $regex: new RegExp(booking.airline.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i') },
      }).lean();
    }

    // Pricing calculations
    const pricePaid    = parseFloat(booking.pricePaid) || 0;
    const currentPrice = booking.lowestPriceSeen
      ? parseFloat(booking.lowestPriceSeen)
      : parseFloat((pricePaid * 0.85).toFixed(2));
    const passengers   = booking.passengers || 1;
    const diffPerPax   = parseFloat((pricePaid - currentPrice).toFixed(2));
    const totalDiff    = parseFloat((diffPerPax * passengers).toFixed(2));
    const totalPaid    = parseFloat((pricePaid * passengers).toFixed(2));

    // Determine refund type hint from policy
    const refundTypes   = policy?.policies?.refundTypes || {};
    const hasCash       = Object.values(refundTypes).some(v => v && v.toString().toLowerCase().includes('cash'));
    const refundMethod  = hasCash ? 'refund' : 'travel credit';
    const paymentMethod = hasCash ? 'original payment method' : `${booking.airline} account`;

    // Airline-specific action sentence
    const claimSteps       = policy?.policies?.claimSteps || [];
    const airlineSpecific  = claimSteps.length
      ? `Per your policy, ${claimSteps[0].replace(/^Step \d+: /i, '').toLowerCase()}.`
      : `Please process this request per your standard price adjustment policy.`;

    // Format date nicely
    const depDate = new Date(booking.departureDate);
    const depDateStr = depDate.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    // Cabin class display
    const cabinDisplay = {
      economy: 'Economy', premium_economy: 'Premium Economy',
      business: 'Business', first: 'First Class',
    }[booking.cabinClass] || booking.cabinClass || 'Economy';

    // User details
    const userName  = req.user.name  || 'Traveler';
    const userEmail = req.user.email || '';

    // Build subject
    const confNum  = booking.confirmationNumber || 'N/A';
    const flightNo = booking.flightNumber        || '';
    const subject  = `Price Drop Refund Request — Booking ${confNum}` +
      (flightNo ? ` — ${flightNo}` : '') +
      ` — ${booking.origin}→${booking.destination}` +
      ` — ${depDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    // Build body
    const body = [
      `Dear ${booking.airline} Customer Service,`,
      ``,
      `I am writing to request a price adjustment for my upcoming flight.`,
      ``,
      `Booking Details:`,
      `- Confirmation Number: ${confNum}`,
      flightNo ? `- Flight: ${flightNo}` : null,
      `- Route: ${booking.origin} → ${booking.destination}`,
      `- Departure: ${depDateStr}`,
      `- Cabin Class: ${cabinDisplay}`,
      `- Passengers: ${passengers}`,
      ``,
      `At the time of booking, I paid $${pricePaid.toFixed(2)} per person ($${totalPaid.toFixed(2)} total for ${passengers} passenger${passengers > 1 ? 's' : ''}).`,
      ``,
      `The current price for the same flight is $${currentPrice.toFixed(2)} per person, a difference of $${diffPerPax.toFixed(2)} per person ($${totalDiff.toFixed(2)} total).`,
      ``,
      `Per ${booking.airline}'s price adjustment policy, I am respectfully requesting a ${refundMethod} of $${totalDiff.toFixed(2)} to my ${paymentMethod}.`,
      ``,
      airlineSpecific,
      ``,
      `Thank you for your assistance. I look forward to your response.`,
      ``,
      `Sincerely,`,
      userName,
      userEmail,
    ].filter(line => line !== null).join('\n');

    res.json({
      subject,
      body,
      claimUrl:   policy?.policies?.claimUrl   || null,
      claimPhone: policy?.policies?.claimPhone || null,
    });
  } catch (err) {
    console.error('[bookings] claim-email error:', err.message);
    res.status(500).json({ error: 'Failed to generate claim email' });
  }
});

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
