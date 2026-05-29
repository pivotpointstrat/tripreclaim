const express = require('express');
const router = express.Router();
const axios = require('axios');

const SEARCHAPI_KEY = process.env.SEARCHAPI_KEY;
const SEARCHAPI_BASE = 'https://www.searchapi.io/api/v1/search';

/**
 * POST /api/calculator/check-price
 * Real-time flight price check for the calculator
 * Returns actual current prices vs price paid — not just heuristic probability
 */
router.post('/check-price', async (req, res) => {
  const { origin, destination, outbound_date, return_date, price_paid, trip_type } = req.body;

  if (!origin || !destination || !outbound_date) {
    return res.status(400).json({ error: 'origin, destination, and outbound_date are required' });
  }

  if (!SEARCHAPI_KEY) {
    return res.status(503).json({ error: 'Price check service unavailable' });
  }

  try {
    const params = {
      engine: 'google_flights',
      departure_id: origin.toUpperCase(),
      arrival_id: destination.toUpperCase(),
      outbound_date,
      currency: 'USD',
      hl: 'en',
      api_key: SEARCHAPI_KEY,
    };

    // Add return date for round trips
    if (trip_type === 'roundtrip' && return_date) {
      params.return_date = return_date;
      params.type = '1'; // round trip
    } else {
      params.type = '2'; // one way
    }

    const resp = await axios.get(SEARCHAPI_BASE, { params, timeout: 15000 });
    const data = resp.data;

    // Extract all flight prices from results
    const allFlights = [
      ...(data.best_flights || []),
      ...(data.other_flights || []),
    ];

    if (!allFlights.length) {
      return res.json({
        found: false,
        message: 'No current flights found for this route and date',
      });
    }

    // Get lowest current price
    const prices = allFlights
      .map(f => f.price)
      .filter(p => typeof p === 'number' && p > 0);

    if (!prices.length) {
      return res.json({ found: false, message: 'Could not extract prices from results' });
    }

    const lowestPrice = Math.min(...prices);
    const paidAmount = parseFloat(price_paid) || 0;
    const savings = paidAmount > 0 ? Math.max(0, paidAmount - lowestPrice) : 0;
    const priceDropFound = paidAmount > 0 && lowestPrice < paidAmount;

    // Build Google Flights deep link
    const googleFlightsUrl = `https://www.google.com/travel/flights/search?tfs=CBwQAhooagcIARIDJFK`
      + `&curr=USD`; // Simplified — just link to Google Flights

    // Return cheapest few options for display
    const topOptions = allFlights
      .filter(f => f.price > 0)
      .sort((a, b) => a.price - b.price)
      .slice(0, 3)
      .map(f => ({
        price: f.price,
        airline: f.flights?.[0]?.airline || 'Unknown',
        duration: f.total_duration,
        stops: f.flights ? f.flights.length - 1 : 0,
      }));

    res.json({
      found: true,
      lowestPrice,
      pricePaid: paidAmount,
      savings: parseFloat(savings.toFixed(2)),
      priceDropFound,
      percentDrop: paidAmount > 0 ? Math.round((savings / paidAmount) * 100) : 0,
      topOptions,
      totalFlightsFound: allFlights.length,
      searchedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[calculator] check-price error:', err.message);
    // Return graceful fallback — don't break the calculator
    res.json({
      found: false,
      message: 'Live price check temporarily unavailable',
      error: true,
    });
  }
});

module.exports = router;
