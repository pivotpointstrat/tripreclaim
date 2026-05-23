/**
 * Confirmation Email Parser Service
 * Parses airline booking confirmation emails to extract flight details.
 * Called when a user forwards their confirmation email to track@tripreclaim.com
 */

// ─────────────────────────────────────────────
// CITY NAME → IATA CODE MAPPING
// ─────────────────────────────────────────────
const CITY_TO_IATA = {
  // North America
  'new york jfk': 'JFK', 'new york lga': 'LGA', 'new york ewr': 'EWR',
  'john f kennedy': 'JFK', 'laguardia': 'LGA', 'newark': 'EWR',
  'los angeles': 'LAX', 'chicago o\'hare': 'ORD', "chicago o'hare": 'ORD', 'chicago midway': 'MDW',
  'san francisco': 'SFO', 'miami': 'MIA', 'atlanta': 'ATL',
  'dallas fort worth': 'DFW', 'dallas': 'DFW', 'houston george bush': 'IAH', 'houston': 'IAH',
  'boston': 'BOS', 'seattle': 'SEA', 'denver': 'DEN', 'phoenix': 'PHX',
  'washington dulles': 'IAD', 'dulles': 'IAD', 'reagan': 'DCA', 'washington dc': 'IAD',
  'las vegas': 'LAS', 'orlando': 'MCO', 'minneapolis': 'MSP', 'detroit': 'DTW',
  'salt lake city': 'SLC', 'portland': 'PDX', 'san diego': 'SAN',
  'toronto pearson': 'YYZ', 'toronto': 'YYZ', 'vancouver': 'YVR', 'montreal': 'YUL',
  'cancun': 'CUN', 'mexico city': 'MEX',
  // Europe
  'london heathrow': 'LHR', 'heathrow': 'LHR', 'london gatwick': 'LGW', 'gatwick': 'LGW',
  'london city': 'LCY', 'stansted': 'STN', 'luton': 'LTN', 'london': 'LHR',
  'paris charles de gaulle': 'CDG', 'paris cdg': 'CDG', 'paris orly': 'ORY', 'paris': 'CDG',
  'amsterdam': 'AMS', 'frankfurt': 'FRA', 'munich': 'MUC', 'zurich': 'ZRH',
  'geneva': 'GVA', 'geneva airport': 'GVA',
  'rome fiumicino': 'FCO', 'rome': 'FCO', 'milan malpensa': 'MXP', 'milan': 'MXP',
  'madrid': 'MAD', 'barcelona': 'BCN', 'lisbon': 'LIS', 'dublin': 'DUB',
  'brussels': 'BRU', 'vienna': 'VIE', 'copenhagen': 'CPH', 'stockholm': 'ARN',
  'oslo': 'OSL', 'helsinki': 'HEL', 'warsaw': 'WAW', 'prague': 'PRG',
  'istanbul': 'IST', 'athens': 'ATH', 'budapest': 'BUD',
  // Asia
  'tokyo narita': 'NRT', 'narita': 'NRT', 'tokyo haneda': 'HND', 'haneda': 'HND', 'tokyo': 'NRT',
  'seoul incheon': 'ICN', 'incheon': 'ICN', 'seoul': 'ICN',
  'beijing': 'PEK', 'shanghai pudong': 'PVG', 'shanghai': 'PVG',
  'hong kong': 'HKG', 'singapore changi': 'SIN', 'singapore': 'SIN',
  'bangkok suvarnabhumi': 'BKK', 'bangkok': 'BKK', 'dubai': 'DXB', 'abu dhabi': 'AUH',
  'doha': 'DOH', 'kuala lumpur': 'KUL', 'jakarta': 'CGK', 'manila': 'MNL',
  'taipei': 'TPE', 'osaka': 'KIX', 'delhi': 'DEL', 'mumbai': 'BOM',
  'phnom penh': 'PNH', 'phnom penh techo': 'KTI', 'techo': 'KTI',
  // Oceania
  'sydney': 'SYD', 'melbourne': 'MEL', 'brisbane': 'BNE', 'auckland': 'AKL',
  // Africa
  'cape town': 'CPT', 'johannesburg': 'JNB', 'nairobi': 'NBO', 'cairo': 'CAI',
};

const cityToIata = (name) => {
  const key = name.toLowerCase().trim();
  // Exact match first
  if (CITY_TO_IATA[key]) return CITY_TO_IATA[key];
  // Partial match
  for (const [city, code] of Object.entries(CITY_TO_IATA)) {
    if (key.includes(city) || city.includes(key)) return code;
  }
  return null;
};

// ─────────────────────────────────────────────
// AIRLINE-SPECIFIC PARSERS
// ─────────────────────────────────────────────

/**
 * Detect which airline sent this email
 */
const detectAirline = (from, subject, body) => {
  const text = `${from} ${subject} ${body}`.toLowerCase();
  // US Carriers
  if (text.includes('americanairlines') || text.includes('aa.com') || text.includes('american airlines')) return 'American Airlines';
  if (text.includes('delta.com') || text.includes('deltaairlines') || text.includes('delta air lines')) return 'Delta';
  if (text.includes('united.com') || text.includes('unitedairlines') || text.includes('united airlines')) return 'United';
  if (text.includes('jetblue.com') || text.includes('jetblue')) return 'JetBlue';
  if (text.includes('alaskaair.com') || text.includes('alaska airlines')) return 'Alaska Airlines';
  if (text.includes('southwest.com') || text.includes('southwest airlines')) return 'Southwest';
  if (text.includes('spirit.com') || text.includes('spirit airlines')) return 'Spirit Airlines';
  if (text.includes('frontier.com') || text.includes('frontier airlines')) return 'Frontier Airlines';
  // European Carriers
  if (text.includes('britishairways.com') || text.includes('british airways') || text.includes('ba.com')) return 'British Airways';
  if (text.includes('lufthansa.com') || text.includes('lufthansa')) return 'Lufthansa';
  if (text.includes('airfrance.com') || text.includes('air france')) return 'Air France';
  if (text.includes('klm.com') || text.includes('klm royal dutch')) return 'KLM';
  if (text.includes('virginatlantic.com') || text.includes('virgin atlantic')) return 'Virgin Atlantic';
  if (text.includes('easyjet.com') || text.includes('easyjet')) return 'EasyJet';
  if (text.includes('ryanair.com') || text.includes('ryanair')) return 'Ryanair';
  if (text.includes('swiss.com') || text.includes('swiss international') || text.includes('swiss air lines')) return 'Swiss';
  if (text.includes('austrianairlines.com') || text.includes('austrian airlines')) return 'Austrian Airlines';
  if (text.includes('iberia.com') || text.includes('iberia airlines')) return 'Iberia';
  if (text.includes('tap') && (text.includes('tapair.pt') || text.includes('tap air portugal'))) return 'TAP Air Portugal';
  if (text.includes('sas.se') || text.includes('flysas.com') || text.includes('scandinavian airlines')) return 'SAS';
  if (text.includes('finnair.com') || text.includes('finnair')) return 'Finnair';
  if (text.includes('norwegian.com') || text.includes('norwegian air')) return 'Norwegian';
  if (text.includes('turkishairlines.com') || text.includes('turkish airlines')) return 'Turkish Airlines';
  // Middle East
  if (text.includes('qatarairways.com') || text.includes('qatar airways')) return 'Qatar Airways';
  if (text.includes('emiratesairlines.com') || text.includes('emirates.com') || text.includes('emirates')) return 'Emirates';
  if (text.includes('etihad.com') || text.includes('etihad airways')) return 'Etihad Airways';
  // Asia Pacific
  if (text.includes('koreanair.com') || text.includes('korean air') || text.includes('대한항공')) return 'Korean Air';
  if (text.includes('singaporeair.com') || text.includes('singapore airlines')) return 'Singapore Airlines';
  if (text.includes('cathaypacific.com') || text.includes('cathay pacific')) return 'Cathay Pacific';
  if (text.includes('ana.co.jp') || text.includes('all nippon airways')) return 'ANA';
  if (text.includes('jal.com') || text.includes('japan airlines')) return 'Japan Airlines';
  if (text.includes('airasia.com') || text.includes('air asia')) return 'AirAsia';
  if (text.includes('airindia.in') || text.includes('air india')) return 'Air India';
  // Americas
  if (text.includes('aircanada.com') || text.includes('air canada')) return 'Air Canada';
  if (text.includes('aeromexico.com') || text.includes('aeroméxico') || text.includes('aeromexico')) return 'Aeromexico';
  if (text.includes('latam.com') || text.includes('latam airlines')) return 'LATAM';
  return null;
};

/**
 * Extract confirmation / booking reference number
 */
const extractConfirmationNumber = (airline, body) => {
  // Airline-specific patterns first
  const airlinePatterns = {
    'British Airways': [
      /booking\s*reference[:\s]+([A-Z0-9]{6})/i,
      /reference\s*number[:\s]+([A-Z0-9]{6})/i,
      /pnr[:\s]+([A-Z0-9]{6})/i,
    ],
    'Korean Air': [
      /booking\s*(?:number|reference|code)[:\s]+([A-Z0-9]{6,8})/i,
      /reservation\s*(?:number|code)[:\s]+([A-Z0-9]{6,8})/i,
      /pnr[:\s]+([A-Z0-9]{6})/i,
    ],
    'Lufthansa': [
      /booking\s*code[:\s]+([A-Z0-9]{6})/i,
      /order\s*number[:\s]+([A-Z0-9]{6,10})/i,
    ],
    'Turkish Airlines': [
      /reservation\s*code[:\s]+([A-Z0-9]{6})/i,
      /pnr[:\s]+([A-Z0-9]{6})/i,
    ],
    'Singapore Airlines': [
      /booking\s*reference[:\s]+([A-Z0-9]{6})/i,
      /pnr[:\s]+([A-Z0-9]{6})/i,
    ],
  };

  if (airline && airlinePatterns[airline]) {
    for (const pattern of airlinePatterns[airline]) {
      const m = body.match(pattern);
      if (m && m[1] && m[1].length >= 5) return m[1].toUpperCase();
    }
  }

  const patterns = [
    /confirmation\s*(?:code|number|#)?[:\s]+([A-Z0-9]{5,8})/i,
    /booking\s*(?:reference|ref|code|number)?[:\s]+([A-Z0-9]{5,8})/i,
    /record\s*locator[:\s]+([A-Z0-9]{5,8})/i,
    /reservation\s*(?:code|number)?[:\s]+([A-Z0-9]{5,8})/i,
    /pnr[:\s]+([A-Z0-9]{5,8})/i,
    /your\s*(?:booking|confirmation)\s*(?:is|code|ref)?[:\s]+([A-Z0-9]{5,8})/i,
    /order\s*(?:number|#)[:\s]+([A-Z0-9]{5,10})/i,
    // Generic 6-character code
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
    'Southwest': 'WN',
    'Spirit Airlines': 'NK',
    'Frontier Airlines': 'F9',
    'British Airways': 'BA',
    'Lufthansa': 'LH',
    'Air France': 'AF',
    'KLM': 'KL',
    'Virgin Atlantic': 'VS',
    'EasyJet': 'U2',
    'Ryanair': 'FR',
    'Swiss': 'LX',
    'Austrian Airlines': 'OS',
    'Iberia': 'IB',
    'TAP Air Portugal': 'TP',
    'SAS': 'SK',
    'Finnair': 'AY',
    'Norwegian': 'DY',
    'Turkish Airlines': 'TK',
    'Qatar Airways': 'QR',
    'Emirates': 'EK',
    'Etihad Airways': 'EY',
    'Korean Air': 'KE',
    'Singapore Airlines': 'SQ',
    'Cathay Pacific': 'CX',
    'ANA': 'NH',
    'Japan Airlines': 'JL',
    'AirAsia': 'AK',
    'Air India': 'AI',
    'Air Canada': 'AC',
    'Aeromexico': 'AM',
    'LATAM': 'LA',
  };
  const code = codes[airline] || '';
  if (code) {
    const m = body.match(new RegExp(`\\b(${code}\\s*\\d{1,4})\\b`, 'i'));
    if (m) return m[1].replace(/\s+/, '');
  }
  const m = body.match(/\bflight\s+(?:number\s+)?([A-Z]{1,2}\s*\d{1,4})\b/i);
  if (m) return m[1].replace(/\s+/, '');
  return null;
};

/**
 * Extract IATA airport codes — supports codes AND city names
 */
const extractRoute = (body) => {
  // 1. Direct IATA code patterns
  const codePatterns = [
    /\b([A-Z]{3})\s*(?:→|->|–|-|to)\s*([A-Z]{3})\b/,
    /\(([A-Z]{3})\)\s*(?:to|→)\s*\(([A-Z]{3})\)/i,
    /depart(?:ing|ure)?[^A-Z]*([A-Z]{3})[^A-Z]*arriv(?:ing|al)?[^A-Z]*([A-Z]{3})/i,
    /from[:\s]+([A-Z]{3})[\s\S]{0,20}to[:\s]+([A-Z]{3})/i,
    // Parenthetical format: "Geneva (GVA) to London Heathrow (LHR)"
    /([A-Z]{3})\).*?\(([A-Z]{3})\)/,
  ];
  for (const pattern of codePatterns) {
    const m = body.match(pattern);
    if (m && m[1] && m[2] && m[1] !== m[2] && m[1].length === 3 && m[2].length === 3) {
      return { origin: m[1].toUpperCase(), destination: m[2].toUpperCase() };
    }
  }

  // 2. City name patterns → IATA lookup
  // British Airways style: "Geneva to London Heathrow" or "London Heathrow to Geneva"
  const cityPatterns = [
    /([A-Za-z][A-Za-z\s]+?)\s+to\s+([A-Za-z][A-Za-z\s]+?)(?:\s*\n|\s*\(|\s*on\s|\s*\||$)/i,
    /from\s+([A-Za-z][A-Za-z\s]+?)\s+to\s+([A-Za-z][A-Za-z\s]+?)(?:\s*\n|\s*\(|$)/i,
    /departing[:\s]+([A-Za-z][A-Za-z\s]+?)\s+arriving[:\s]+([A-Za-z][A-Za-z\s]+?)(?:\s*\n|$)/i,
  ];
  for (const pattern of cityPatterns) {
    const m = body.match(pattern);
    if (m && m[1] && m[2]) {
      const origin = cityToIata(m[1].trim());
      const destination = cityToIata(m[2].trim());
      if (origin && destination && origin !== destination) {
        return { origin, destination };
      }
    }
  }

  return null;
};

/**
 * Extract departure date
 */
const extractDate = (body) => {
  const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
  const monthRe = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

  const tryParse = (fn) => {
    try {
      const d = fn();
      if (d && !isNaN(d) && d > new Date()) return d.toISOString().split('T')[0];
    } catch (_) {}
    return null;
  };

  // YYYY-MM-DD
  let m = body.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) {
    const r = tryParse(() => new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
    if (r) return r;
  }

  // Month DD, YYYY: June 15, 2026
  m = body.match(new RegExp(monthRe + '\\s+(\\d{1,2}),?\\s+(20\\d{2})', 'i'));
  if (m) {
    const r = tryParse(() => {
      const mo = months[m[1].toLowerCase().substring(0, 3)];
      return mo !== undefined ? new Date(parseInt(m[3]), mo, parseInt(m[2])) : null;
    });
    if (r) return r;
  }

  // DD Month YYYY: 15 June 2026
  m = body.match(new RegExp('(\\d{1,2})\\s+' + monthRe + '\\s+(20\\d{2})', 'i'));
  if (m) {
    const r = tryParse(() => {
      const mo = months[m[2].toLowerCase().substring(0, 3)];
      return mo !== undefined ? new Date(parseInt(m[3]), mo, parseInt(m[1])) : null;
    });
    if (r) return r;
  }

  // Weekday, DD Month YYYY: Monday, 15 June 2026 (British Airways style)
  m = body.match(new RegExp('(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\\s+(\\d{1,2})\\s+' + monthRe + '\\s+(20\\d{2})', 'i'));
  if (m) {
    const r = tryParse(() => {
      const mo = months[m[2].toLowerCase().substring(0, 3)];
      return mo !== undefined ? new Date(parseInt(m[3]), mo, parseInt(m[1])) : null;
    });
    if (r) return r;
  }

  // MM/DD/YYYY or MM-DD-YYYY
  m = body.match(/(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})/);
  if (m) {
    const r = tryParse(() => new Date(`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`));
    if (r) return r;
  }

  return null;
};

/**
 * Extract cabin class
 */
const extractCabin = (body) => {
  const b = body.toLowerCase();
  if (b.includes('first class') || b.includes('first cabin') || b.includes('first suite')) return 'first';
  if (b.includes('business class') || b.includes('business cabin') ||
      b.includes('polaris') || b.includes('delta one') || b.includes('club world') ||
      b.includes('club suite') || b.includes('prestige class') ||
      b.includes('first/business') || b.includes('business/first')) return 'business';
  if (b.includes('premium economy') || b.includes('premium cabin') ||
      b.includes('world traveller plus') || b.includes('comfort+') || b.includes('comfort plus') ||
      b.includes('premium flex') || b.includes('economy plus')) return 'premium_economy';
  if (b.includes('basic economy') || b.includes('basic fare') || b.includes('light fare')) return 'basic_economy';
  return 'economy';
};

/**
 * Extract price paid — currency-aware
 */
const extractPrice = (body) => {
  // Currency-aware patterns: USD, GBP, EUR, etc.
  const currencyPatterns = [
    // USD explicit
    /total[:\s]+USD\s*([\d,]+(?:\.\d{2})?)/i,
    /total[:\s]+\$([\d,]+(?:\.\d{2})?)/i,
    /total\s*amount[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
    // GBP — British Airways
    /total[:\s]+GBP\s*([\d,]+(?:\.\d{2})?)/i,
    /total[:\s]+£([\d,]+(?:\.\d{2})?)/i,
    /£([\d,]+(?:\.\d{2})?)\s*(?:total|charged|paid)/i,
    // EUR
    /total[:\s]+EUR\s*([\d,]+(?:\.\d{2})?)/i,
    /total[:\s]+€([\d,]+(?:\.\d{2})?)/i,
    /€([\d,]+(?:\.\d{2})?)\s*(?:total|charged|paid)/i,
    // Generic patterns
    /total\s*(?:charged|paid|amount|fare|cost)?[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
    /amount\s*(?:charged|paid|billed)?[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
    /you\s*(?:paid|were charged)[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
    /payment[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
    /\$([\d,]+(?:\.\d{2})?)\s*(?:total|charged|paid|usd)/i,
    /grand\s*total[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
    /amount\s*paid[:\s]+[A-Z]{3}\s*([\d,]+(?:\.\d{2})?)/i,
  ];
  for (const pattern of currencyPatterns) {
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
    /travelling\s*(?:with|as)[:\s]+([1-9])\s*(?:people|person|adults?)/i,
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
