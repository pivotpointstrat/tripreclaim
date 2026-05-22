/**
 * Confirmation Email Parser Service
 * Parses airline booking confirmation emails to extract flight details.
 * Called when a user forwards their confirmation email to track@tripreclaim.com
 */

// ─────────────────────────────────────────────
// AIRLINE-SPECIFIC PARSERS
// ─────────────────────────────────────────────

/**
 * Detect which airline sent this email
 */
const detectAirline = (from, subject, body) => {
  const text = `${from} ${subject} ${body}`.toLowerCase();
  if (text.includes('americanairlines') || text.includes('aa.com') || text.includes('american airlines')) return 'American Airlines';
  if (text.includes('delta.com') || text.includes('deltaairlines') || text.includes('delta air lines')) return 'Delta';
  if (text.includes('united.com') || text.includes('unitedairlines') || text.includes('united airlines')) return 'United';
  if (text.includes('jetblue.com') || text.includes('jetblue')) return 'JetBlue';
  if (text.includes('alaskaair.com') || text.includes('alaska airlines')) return 'Alaska Airlines';
  if (text.includes('britishairways.com') || text.includes('british airways')) return 'British Airways';
  if (text.includes('lufthansa.com') || text.includes('lufthansa')) return 'Lufthansa';
  if (text.includes('southwest.com') || text.includes('southwest airlines')) return 'Southwest';
  if (text.includes('qatarairways.com') || text.includes('qatar airways')) return 'Qatar Airways';
  if (text.includes('emiratesairlines.com') || text.includes('emirates.com') || text.includes('emirates')) return 'Emirates';
  if (text.includes('aircanada.com') || text.includes('air canada')) return 'Air Canada';
  if (text.includes('airfrance.com') || text.includes('air france')) return 'Air France';
  if (text.includes('klm.com') || text.includes('klm')) return 'KLM';
  if (text.includes('virginatlantic.com') || text.includes('virgin atlantic')) return 'Virgin Atlantic';
  return null;
};

/**
 * Extract confirmation / booking reference number
 */
const extractConfirmationNumber = (airline, body) => {
  const patterns = [
    // Airline-specific
    /confirmation\s*(?:code|number|#)?[:\s]+([A-Z0-9]{5,8})/i,
    /booking\s*(?:reference|ref|code|number)?[:\s]+([A-Z0-9]{5,8})/i,
    /record\s*locator[:\s]+([A-Z0-9]{5,8})/i,
    /reservation\s*(?:code|number)?[:\s]+([A-Z0-9]{5,8})/i,
    /pnr[:\s]+([A-Z0-9]{5,8})/i,
    /your\s*(?:booking|confirmation)\s*(?:is|code|ref)?[:\s]+([A-Z0-9]{5,8})/i,
    // Generic 6-character code common to most airlines
    /\b([A-Z]{2}[A-Z0-9]{4})\b/,
    /\b([A-Z][A-Z0-9]{5})\b/,
  ];
  for (const pattern of patterns) {
    const m = body.match(pattern);
    if (m && m[1] && m[1].length >= 5) return m[1].toUpperCase();
  }
  return null;
};

/**
 * Extract flight numbers
 */
const extractFlightNumber = (airline, body) => {
  const codes = {
    'American Airlines': 'AA',
    'Delta': 'DL',
    'United': 'UA',
    'JetBlue': 'B6',
    'Alaska Airlines': 'AS',
    'British Airways': 'BA',
    'Lufthansa': 'LH',
    'Southwest': 'WN',
    'Qatar Airways': 'QR',
    'Emirates': 'EK',
    'Air Canada': 'AC',
    'Air France': 'AF',
    'KLM': 'KL',
    'Virgin Atlantic': 'VS',
  };
  const code = codes[airline] || '';
  // Try airline-specific pattern first
  if (code) {
    const m = body.match(new RegExp(`\\b(${code}\\s*\\d{1,4})\\b`, 'i'));
    if (m) return m[1].replace(/\s+/, '');
  }
  // Generic flight number pattern
  const m = body.match(/\bflight\s+(?:number\s+)?([A-Z]{1,2}\s*\d{1,4})\b/i);
  if (m) return m[1].replace(/\s+/, '');
  return null;
};

/**
 * Extract IATA airport codes from body text
 */
const extractRoute = (body) => {
  // Common patterns: JFK → LAX, JFK-LAX, JFK to LAX, (JFK) to (LAX)
  const patterns = [
    /\b([A-Z]{3})\s*(?:→|->|–|-|to)\s*([A-Z]{3})\b/,
    /\(([A-Z]{3})\)\s*(?:to|→)\s*\(([A-Z]{3})\)/i,
    /depart(?:ing|ure)?[^A-Z]*([A-Z]{3})[^A-Z]*arriv(?:ing|al)?[^A-Z]*([A-Z]{3})/i,
    /from[:\s]+([A-Z]{3})[\s\S]{0,20}to[:\s]+([A-Z]{3})/i,
  ];
  for (const pattern of patterns) {
    const m = body.match(pattern);
    if (m && m[1] && m[2] && m[1] !== m[2]) {
      return { origin: m[1].toUpperCase(), destination: m[2].toUpperCase() };
    }
  }
  return null;
};

/**
 * Extract departure date
 */
const extractDate = (body) => {
  const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
  const patterns = [
    // YYYY-MM-DD
    /\b(20\d{2})-(\d{2})-(\d{2})\b/,
    // Month Day, Year: June 15, 2026
    /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})/i,
    // DD Month YYYY: 15 June 2026
    /(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})/i,
    // MM/DD/YYYY or MM-DD-YYYY
    /(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})/,
  ];
  for (const pattern of patterns) {
    const m = body.match(pattern);
    if (!m) continue;
    try {
      let d;
      if (pattern.source.startsWith('\\b(20')) {
        d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      } else if (/Jan|Feb|Mar/.test(pattern.source) && m.index !== undefined) {
        const monthStr = m[1].toLowerCase().substring(0, 3);
        const day = parseInt(m[2]);
        const year = parseInt(m[3]);
        if (months[monthStr] !== undefined) d = new Date(year, months[monthStr], day);
      } else if (/\\d{1,2}\}\\s\+\(Jan/.test(pattern.source)) {
        const day = parseInt(m[1]);
        const monthStr = m[2].toLowerCase().substring(0, 3);
        const year = parseInt(m[3]);
        if (months[monthStr] !== undefined) d = new Date(year, months[monthStr], day);
      } else {
        d = new Date(`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`);
      }
      if (d && !isNaN(d) && d > new Date()) {
        return d.toISOString().split('T')[0];
      }
    } catch (_) {}
  }
  return null;
};

/**
 * Extract cabin class
 */
const extractCabin = (body) => {
  const b = body.toLowerCase();
  if (b.includes('first class') || b.includes('first cabin')) return 'first';
  if (b.includes('business class') || b.includes('business cabin') ||
      b.includes('polaris') || b.includes('delta one') || b.includes('club world')) return 'business';
  if (b.includes('premium economy') || b.includes('premium cabin') ||
      b.includes('world traveller plus') || b.includes('comfort+') || b.includes('comfort plus')) return 'premium_economy';
  if (b.includes('basic economy') || b.includes('basic fare')) return 'basic_economy';
  return 'economy';
};

/**
 * Extract price paid
 */
const extractPrice = (body) => {
  const patterns = [
    /total\s*(?:charged|paid|amount|fare|cost)?[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
    /amount\s*(?:charged|paid|billed)?[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
    /you\s*(?:paid|were charged)[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
    /payment[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
    /\$([\d,]+(?:\.\d{2})?)\s*(?:total|charged|paid|usd)/i,
    /grand\s*total[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
  ];
  for (const pattern of patterns) {
    const m = body.match(pattern);
    if (m) {
      const price = parseFloat(m[1].replace(/,/g, ''));
      if (price > 10 && price < 50000) return price;
    }
  }
  return null;
};

/**
 * Extract number of passengers
 */
const extractPassengers = (body) => {
  const patterns = [
    /([1-9])\s*(?:adult|passenger|travell?er|pax)/i,
    /(?:adult|passenger|travell?er|pax)s?[:\s]+([1-9])/i,
    /([1-9])\s*(?:ticket|seat)s?/i,
  ];
  for (const pattern of patterns) {
    const m = body.match(pattern);
    if (m) return parseInt(m[1]);
  }
  return 1;
};

// ─────────────────────────────────────────────
// MAIN PARSER
// ─────────────────────────────────────────────

/**
 * Parse a forwarded confirmation email.
 * @param {object} emailData - { from, subject, text, html }
 * @returns {{ success: boolean, data?: object, confidence: number, missingFields: string[] }}
 */
const parseConfirmationEmail = (emailData) => {
  const { from = '', subject = '', text = '', html = '' } = emailData;

  // Use text content preferably, fall back to HTML stripped of tags
  const body = text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Detect airline
  const airline = detectAirline(from, subject, body);

  // Extract all fields
  const confirmationNumber = extractConfirmationNumber(airline, body);
  const flightNumber = extractFlightNumber(airline, body);
  const route = extractRoute(body);
  const departureDate = extractDate(body);
  const cabinClass = extractCabin(body);
  const pricePaid = extractPrice(body);
  const passengers = extractPassengers(body);

  // Calculate confidence score
  let confidence = 0;
  const missingFields = [];
  if (airline)            confidence += 20; else missingFields.push('airline');
  if (confirmationNumber) confidence += 20; else missingFields.push('confirmationNumber');
  if (route)              confidence += 25; else missingFields.push('route (origin/destination)');
  if (departureDate)      confidence += 15; else missingFields.push('departureDate');
  if (pricePaid)          confidence += 15; else missingFields.push('pricePaid');
  if (flightNumber)       confidence += 5;

  // Require at minimum: route + either airline or confirmation number
  if (!route || (!airline && !confirmationNumber)) {
    return {
      success: false,
      confidence,
      missingFields,
      error: 'Could not extract flight details from this email. Please make sure you forwarded a booking confirmation email.'
    };
  }

  const data = {
    airline,
    confirmationNumber,
    flightNumber,
    origin:        route?.origin || null,
    destination:   route?.destination || null,
    departureDate,
    cabinClass,
    pricePaid,
    passengers,
    parsedFrom:    'email',
    confidence,
  };

  return { success: true, data, confidence, missingFields };
};

module.exports = { parseConfirmationEmail, detectAirline };
