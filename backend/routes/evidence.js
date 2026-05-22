/**
 * Evidence Route — /bookings/:id/evidence
 * Returns price evidence archive for a booking (authenticated)
 */
const express  = require('express');
const router   = express.Router();
const Booking  = require('../models/Booking');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /bookings/:id/evidence
 * Returns all price evidence entries for a booking belonging to the authenticated user.
 */
router.get('/:id/evidence', requireAuth, async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      email: req.user.email,
    }).select('origin destination departureDate pricePaid airline priceEvidence createdAt purchasedAt').lean();

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Build a rich evidence response
    const evidenceCount = (booking.priceEvidence || []).length;
    const latestEvidence = evidenceCount > 0
      ? booking.priceEvidence[evidenceCount - 1]
      : null;

    const totalSavingsDetected = (booking.priceEvidence || []).reduce(
      (sum, e) => sum + (e.savings || 0), 0
    );

    res.json({
      booking: {
        id:            booking._id,
        route:         `${booking.origin} → ${booking.destination}`,
        origin:        booking.origin,
        destination:   booking.destination,
        departureDate: booking.departureDate,
        pricePaid:     booking.pricePaid,
        airline:       booking.airline,
        purchasedAt:   booking.purchasedAt || booking.createdAt,
      },
      evidenceSummary: {
        totalAlerts:          evidenceCount,
        totalSavingsDetected: totalSavingsDetected,
        latestDropPrice:      latestEvidence ? latestEvidence.currentPrice : null,
        latestDropAt:         latestEvidence ? latestEvidence.detectedAt    : null,
        latestGoogleFlights:  latestEvidence ? latestEvidence.googleFlightsUrl : null,
      },
      evidence: (booking.priceEvidence || []).map(e => ({
        detectedAt:       e.detectedAt,
        currentPrice:     e.currentPrice,
        pricePaid:        e.pricePaid,
        savings:          e.savings,
        alertType:        e.alertType,
        googleFlightsUrl: e.googleFlightsUrl,
        serpApiSummary:   e.serpApiSummary || [],
      })).reverse(), // most recent first
    });
  } catch (err) {
    console.error('[evidence] Error fetching evidence:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
