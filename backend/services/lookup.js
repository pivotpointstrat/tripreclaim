/**
 * Airline Booking Lookup Service
 * Uses Puppeteer to scrape manage-booking pages.
 * Returns structured booking data so the dashboard can auto-fill.
 */
const puppeteer = require('puppeteer-core');

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--window-size=1280,800',
];

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** Launch a stealth browser instance */
const launchBrowser = async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: BROWSER_ARGS,
  });
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1280, height: 800 });
  // Remove webdriver fingerprint
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return { browser, page };
};

/** Parse a date string into YYYY-MM-DD */
const parseDate = (str) => {
  if (!str) return null;
  try {
    const d = new Date(str);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  } catch (_) {}
  return null;
};

/** Extract IATA airport code from a string like "New York (JFK)" */
const extractIATA = (str) => {
  if (!str) return null;
  const m = str.match(/\b([A-Z]{3})\b/);
  return m ? m[1] : null;
};

// ─────────────────────────────────────────────
// AIRLINE SCRAPERS
// ─────────────────────────────────────────────

/** American Airlines */
const scrapeAmerican = async (page, confirmationNumber, lastName) => {
  const url = `https://www.aa.com/reservation/view?confirmationCode=${confirmationNumber.toUpperCase()}&lastName=${encodeURIComponent(lastName.toUpperCase())}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || null;
    // AA renders flight info in data-testid attributes
    const origin = getText('[data-testid="departure-airport"]') || getText('.origin-city');
    const dest = getText('[data-testid="arrival-airport"]') || getText('.destination-city');
    const flightNum = getText('[data-testid="flight-number"]') || getText('.flight-number');
    const depDate = getText('[data-testid="departure-date"]') || getText('.departure-date');
    const cabin = getText('[data-testid="cabin-type"]') || getText('.cabin-name');
    const passengers = document.querySelectorAll('[data-testid="passenger-name"]').length ||
                       document.querySelectorAll('.passenger-name').length || 1;
    return { origin, dest, flightNum, depDate, cabin, passengers };
  });
};

/** Delta Air Lines */
const scrapeDelta = async (page, confirmationNumber, lastName) => {
  await page.goto('https://www.delta.com/us/en/trip-type-search/find-my-trip', {
    waitUntil: 'networkidle2', timeout: 30000
  });
  await page.waitForTimeout(1500);

  // Fill in confirmation number
  await page.waitForSelector('#confirmationNumber, [name="confirmationNumber"]', { timeout: 10000 });
  await page.type('#confirmationNumber, [name="confirmationNumber"]', confirmationNumber.toUpperCase());
  await page.type('#lastName, [name="lastName"]', lastName.toUpperCase());

  // Submit
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    page.click('[type="submit"], .find-trip-submit, button[data-testid="find-trip-submit"]'),
  ]);
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || null;
    const origin = getText('.departure-airport-code, [data-testid="origin-airport"]');
    const dest = getText('.arrival-airport-code, [data-testid="destination-airport"]');
    const flightNum = getText('.flight-number, [data-testid="flight-number"]');
    const depDate = getText('.departure-date, [data-testid="departure-date"]');
    const cabin = getText('.cabin-class, [data-testid="cabin-class"]');
    const passengers = document.querySelectorAll('.passenger-name, [data-testid="passenger"]').length || 1;
    return { origin, dest, flightNum, depDate, cabin, passengers };
  });
};

/** United Airlines */
const scrapeUnited = async (page, confirmationNumber, lastName) => {
  await page.goto('https://www.united.com/en/us/manageres/mytrips', {
    waitUntil: 'networkidle2', timeout: 30000
  });
  await page.waitForTimeout(1500);

  await page.waitForSelector('#confirmationNumber, [name="confirmationNumber"], [id*="confirm"]', { timeout: 10000 });
  await page.type('#confirmationNumber, [name="confirmationNumber"]', confirmationNumber.toUpperCase());
  await page.type('#lastName, [name="lastName"]', lastName.toUpperCase());

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    page.click('[type="submit"], button.findFlightButton, [data-testid="submit"]'),
  ]);
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || null;
    const origin = getText('.departure-airport, [data-testid="departure"]');
    const dest = getText('.arrival-airport, [data-testid="arrival"]');
    const flightNum = getText('.flight-number, [data-testid="flightNumber"]');
    const depDate = getText('.departure-date, [data-testid="departureDate"]');
    const cabin = getText('.cabin-type, [data-testid="cabinType"]');
    const passengers = document.querySelectorAll('.traveler-name, [data-testid="traveler"]').length || 1;
    return { origin, dest, flightNum, depDate, cabin, passengers };
  });
};

/** JetBlue */
const scrapeJetBlue = async (page, confirmationNumber, lastName) => {
  await page.goto('https://www.jetblue.com/manage-trips/', {
    waitUntil: 'networkidle2', timeout: 30000
  });
  await page.waitForTimeout(1500);

  await page.waitForSelector('[name="confirmationCode"], #confirmationCode, [placeholder*="confirmation"]', { timeout: 10000 });
  await page.type('[name="confirmationCode"], #confirmationCode', confirmationNumber.toUpperCase());
  await page.type('[name="lastName"], #lastName', lastName.toUpperCase());

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    page.click('[type="submit"], .manage-trips-submit'),
  ]);
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || null;
    const origin = getText('.origin-code, [data-testid="origin"]');
    const dest = getText('.destination-code, [data-testid="destination"]');
    const flightNum = getText('.flight-number, [data-testid="flightNum"]');
    const depDate = getText('.depart-date, [data-testid="departDate"]');
    const cabin = getText('.fare-name, [data-testid="fareClass"]');
    const passengers = document.querySelectorAll('.passenger, [data-testid="pax"]').length || 1;
    return { origin, dest, flightNum, depDate, cabin, passengers };
  });
};

/** Alaska Airlines */
const scrapeAlaska = async (page, confirmationNumber, lastName) => {
  const url = `https://www.alaskaair.com/booking/reservation-details/${confirmationNumber.toUpperCase()}/${lastName.toUpperCase()}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || null;
    const origin = getText('.departure-airport, [data-testid="origin"]');
    const dest = getText('.arrival-airport, [data-testid="destination"]');
    const flightNum = getText('.flight-num, [data-testid="flightNumber"]');
    const depDate = getText('.depart-date, [data-testid="departureDate"]');
    const cabin = getText('.cabin-class, [data-testid="cabin"]');
    const passengers = document.querySelectorAll('.passenger-name, [data-testid="passenger"]').length || 1;
    return { origin, dest, flightNum, depDate, cabin, passengers };
  });
};

// ─────────────────────────────────────────────
// SCRAPER MAP
// ─────────────────────────────────────────────
const SCRAPERS = {
  'American Airlines': scrapeAmerican,
  'Delta':             scrapeDelta,
  'United':            scrapeUnited,
  'JetBlue':           scrapeJetBlue,
  'Alaska Airlines':   scrapeAlaska,
};

/**
 * Main lookup function.
 * @param {string} airline
 * @param {string} confirmationNumber
 * @param {string} lastName
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
const lookupBooking = async (airline, confirmationNumber, lastName) => {
  const scraper = SCRAPERS[airline];
  if (!scraper) {
    return { success: false, error: `Automatic lookup is not available for ${airline}. Please enter your flight details manually.` };
  }

  let browser;
  try {
    console.log(`[lookup] Scraping ${airline} for conf# ${confirmationNumber}`);
    const { browser: b, page } = await launchBrowser();
    browser = b;

    const raw = await scraper(page, confirmationNumber, lastName);
    await browser.close();

    // Normalize results
    const originIATA = extractIATA(raw.origin) || raw.origin;
    const destIATA   = extractIATA(raw.dest) || raw.dest;
    const depDate    = parseDate(raw.depDate);

    // Build flight number
    let flightNumber = raw.flightNum;
    if (flightNumber && !flightNumber.match(/^[A-Z]{2}/)) {
      // Prepend airline code if missing
      const codes = { 'American Airlines': 'AA', 'Delta': 'DL', 'United': 'UA', 'JetBlue': 'B6', 'Alaska Airlines': 'AS' };
      flightNumber = (codes[airline] || '') + flightNumber.replace(/\D/g, '');
    }

    // Check we got at least origin + dest
    if (!originIATA || !destIATA) {
      return { success: false, error: `Could not retrieve booking details from ${airline}. Please check your confirmation number and last name, or enter details manually.` };
    }

    const data = {
      airline,
      confirmationNumber: confirmationNumber.toUpperCase(),
      origin:      originIATA,
      destination: destIATA,
      flightNumber,
      departureDate: depDate,
      cabinClass:  normalizeCabin(raw.cabin),
      passengers:  parseInt(raw.passengers) || 1,
    };

    console.log(`[lookup] ✅ Success for ${airline} ${confirmationNumber}:`, JSON.stringify(data));
    return { success: true, data };

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error(`[lookup] ❌ ${airline} scrape failed: ${err.message}`);
    return { success: false, error: `Could not retrieve booking from ${airline}. Please enter your flight details manually.` };
  }
};

/** Normalize cabin class strings from airline pages */
const normalizeCabin = (cabin) => {
  if (!cabin) return 'economy';
  const c = cabin.toLowerCase();
  if (c.includes('first'))            return 'first';
  if (c.includes('business') || c.includes('polaris') || c.includes('delta one')) return 'business';
  if (c.includes('premium'))          return 'premium_economy';
  return 'economy';
};

module.exports = { lookupBooking, SCRAPERS };
