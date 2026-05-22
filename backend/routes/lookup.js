const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { lookupBooking, SCRAPERS } = require('../services/lookup');

/**
 * GET /lookup/supported-airlines
 * Returns the list of airlines that support automatic lookup
 */
router.get('/supported-airlines', (req, res) => {
  res.json({ airlines: Object.keys(SCRAPERS) });
});

/**
 * POST /lookup/booking
 * Body: { airline, confirmationNumber, lastName }
 * Returns auto-filled booking details or an error message
 */
router.post('/booking', requireAuth, async (req, res) => {
  const { airline, confirmationNumber, lastName } = req.body;

  if (!airline || !confirmationNumber || !lastName) {
    return res.status(400).json({
      error: 'airline, confirmationNumber, and lastName are required'
    });
  }

  if (confirmationNumber.length < 4 || confirmationNumber.length > 10) {
    return res.status(400).json({
      error: 'Confirmation number should be 4–10 characters'
    });
  }

  const result = await lookupBooking(
    airline,
    confirmationNumber.trim().toUpperCase(),
    lastName.trim()
  );

  if (result.success) {
    return res.json({ success: true, data: result.data });
  } else {
    return res.status(422).json({ success: false, error: result.error });
  }
});

module.exports = router;
