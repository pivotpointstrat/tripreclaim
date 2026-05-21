const axios = require('axios');

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const SERPAPI_BASE = 'https://serpapi.com/search';

/**
 * Map airline display names to IATA carrier codes for better search results
 */
const AIRLINE_CODES = {
  'American Airlines': 'AA',
  'Delta': 'DL',
  'United': 'UA',
  'Southwest': 'WN',
  'JetBlue': 'B6',
  'Alaska Airlines': 'AS',
  'Lufthansa': 'LH',
  'British Airways': 'BA',
  'Qatar Airways': 'QR',
};

/**
 * Fetch current lowest price for a route on a given date.
 * Returns the price in USD or null if unavailable.
 * 
 * @param {string} origin    - IATA code e.g. 'JFK'
 * @param {string} dest      - IATA code e.g. 'LAX'
 * @param {string} date      - YYYY-MM-DD format
 * @param {string} airline   - Airline display name (for filtering)
 * @param {string} cabin     - 'economy' | 'premium_economy' | 'business' | 'first'
 * @param {number} passengers
 * @returns {{ price: number|null, rawResults: object }}
 */
const getLowestPrice = async (origin, dest, date, airline, cabin = 'economy', passengers = 1) => {
  const cabinMap = {
    economy: '1',
    premium_economy: '2',
    business: '3',
    first: '4',
  };

  const params = {
    engine: 'google_flights',
    departure_id: origin,
    arrival_id: dest,
    outbound_date: date,
    currency: 'USD',
    hl: 'en',
    type: '2',                          // one-way
    travel_class: cabinMap[cabin] || '1',
    adults: passengers,
    api_key: SERPAPI_KEY,
  };

  try {
    const resp = await axios.get(SERPAPI_BASE, { params, timeout: 15000 });
    const data = resp.data;

    if (data.error) {
      console.error(`[monitor] SerpApi error: ${data.error}`);
      return { price: null, rawResults: data };
    }

    // Collect all flights
    const allFlights = [
      ...(data.best_flights || []),
      ...(data.other_flights || []),
    ];

    if (!allFlights.length) {
      return { price: null, rawResults: data };
    }

    // Try to find a flight matching the specific airline
    const airlineCode = AIRLINE_CODES[airline];
    let matchedFlights = allFlights.filter(f =>
      f.flights && f.flights.some(leg =>
        leg.airline === airline ||
        (airlineCode && leg.airline_logo && leg.airline_logo.includes(airlineCode.toLowerCase())) ||
        (leg.airline && leg.airline.toLowerCase().includes((airline || '').toLowerCase().split(' ')[0]))
      )
    );

    // Fall back to all flights if no airline match
    const candidates = matchedFlights.length > 0 ? matchedFlights : allFlights;

    // Return the lowest price found
    const prices = candidates.map(f => f.price).filter(p => p && p > 0);
    if (!prices.length) return { price: null, rawResults: data };

    const lowestPrice = Math.min(...prices);
    return { price: lowestPrice, rawResults: data };

  } catch (err) {
    console.error(`[monitor] Request failed: ${err.message}`);
    return { price: null, rawResults: null };
  }
};

/**
 * Batch check: given an array of bookings that share the same route + date,
 * make a single API call and return the price for all of them.
 * Returns { price, rawResults }
 */
const batchCheck = async (origin, dest, date, cabin = 'economy', passengers = 1) => {
  return getLowestPrice(origin, dest, date, null, cabin, passengers);
};

module.exports = { getLowestPrice, batchCheck, AIRLINE_CODES };
