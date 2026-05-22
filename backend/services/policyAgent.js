/**
 * TripReclaim — Airline Policy Agent
 *
 * Maintains a knowledge base of airline refund/price-drop policies.
 * Policies are seeded from structured research data and can be refreshed
 * via Firecrawl scraping on a weekly schedule.
 *
 * MongoDB collection: AirlinePolicies
 */

const path = require('path');
const axios = require('axios');
const AirlinePolicy = require('../models/AirlinePolicy');

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_BASE    = 'https://api.firecrawl.dev/v1';

// ─────────────────────────────────────────────────────────────────────────────
// Load scraped policy data from JSON (replaces hardcoded seed data)
// ─────────────────────────────────────────────────────────────────────────────

const SCRAPED_POLICIES_FILE = path.join(__dirname, '../data/airline_policies_scraped.json');
let _rawScrapedPolicies = [];
try {
  _rawScrapedPolicies = require(SCRAPED_POLICIES_FILE);
  console.log(`[policyAgent] Loaded ${_rawScrapedPolicies.length} airline policies from scraped JSON.`);
} catch (e) {
  console.warn('[policyAgent] Could not load airline_policies_scraped.json:', e.message);
}

/**
 * Map a scraped JSON entry to the AirlinePolicy schema shape.
 * All policy fields live under the nested `policies` object in the JSON,
 * which mirrors the Mongoose schema exactly.
 */
const _mapScrapedToSchema = (entry) => ({
  airline: entry.airline,
  code: entry.code,
  dataSource: entry.dataSource || 'scraped',
  scrapedUrl: entry.scrapedUrl || null,
  lastUpdated: entry.lastUpdated ? new Date(entry.lastUpdated) : new Date(),
  policies: {
    priceDropPolicy:    entry.policies.priceDropPolicy    || '',
    twentyFourHourRule: entry.policies.twentyFourHourRule || '',
    basicEconomyRules:  entry.policies.basicEconomyRules  || '',
    awardTicketPolicy:  entry.policies.awardTicketPolicy  || '',
    claimSteps:         entry.policies.claimSteps         || [],
    claimUrl:           entry.policies.claimUrl           || '',
    claimPhone:         entry.policies.claimPhone         || '',
    creditExpiry:       entry.policies.creditExpiry       || '',
    cancellationFees:   entry.policies.cancellationFees   || {},
    refundTypes:        entry.policies.refundTypes        || {},
    loopholes:          entry.policies.loopholes          || [],
  },
});

// Mapped seed policies — used by seedPolicies() below
const SEED_POLICIES = _rawScrapedPolicies.map(_mapScrapedToSchema);


// ─────────────────────────────────────────────────────────────────────────────
// Firecrawl scraping targets per airline
// ─────────────────────────────────────────────────────────────────────────────

const POLICY_URLS = {
  UA: 'https://www.united.com/en/us/fly/travel/baggage/changes-and-cancellations.html',
  AA: 'https://www.aa.com/i18n/travel-info/experience/seats/fare-types.jsp',
  DL: 'https://www.delta.com/us/en/change-cancel/overview',
  WN: 'https://www.southwest.com/html/customer-service/faqs.html?topic=cancel_and_refund',
  AS: 'https://www.alaskaair.com/content/about-us/legal/fare-rules',
  B6: 'https://www.jetblue.com/help/change-and-cancel-policies',
};

// ─────────────────────────────────────────────────────────────────────────────
// Core functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed the database with the static research-based policy data.
 * Uses upsert with $set so richer scraped data overwrites legacy records.
 */
const seedPolicies = async () => {
  let seeded = 0;
  for (const policy of SEED_POLICIES) {
    const { code, ...rest } = policy;
    await AirlinePolicy.findOneAndUpdate(
      { code },
      { $set: rest },
      { upsert: true, new: true }
    );
    seeded++;
  }
  console.log(`[policyAgent] Seeded/updated ${seeded} airline policies from scraped JSON.`);
  return seeded;
};

/**
 * Scrape a single airline's policy page via Firecrawl.
 * Returns extracted text or null on failure.
 */
const scrapeAirlinePolicy = async (airlineCode) => {
  if (!FIRECRAWL_API_KEY) {
    console.warn('[policyAgent] FIRECRAWL_API_KEY not set — skipping scrape');
    return null;
  }

  const url = POLICY_URLS[airlineCode];
  if (!url) {
    console.warn(`[policyAgent] No scrape URL for ${airlineCode}`);
    return null;
  }

  try {
    const resp = await axios.post(
      `${FIRECRAWL_BASE}/scrape`,
      { url, formats: ['markdown'] },
      {
        headers: {
          Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const markdown = resp.data?.data?.markdown || '';
    return markdown.trim() || null;
  } catch (err) {
    console.error(`[policyAgent] Firecrawl error for ${airlineCode}: ${err.message}`);
    return null;
  }
};

/**
 * Detect meaningful changes between old policy text and new scraped text.
 * Simple heuristic: compare keyword presence for key refund/cancellation terms.
 */
const detectPolicyChange = (oldPolicy, newMarkdown) => {
  if (!newMarkdown) return false;
  const keywords = ['cancel', 'refund', 'credit', 'fee', 'change', 'basic economy', '24 hour', 'non-refundable'];
  const oldText = JSON.stringify(oldPolicy.policies || '').toLowerCase();
  const newText = newMarkdown.toLowerCase();
  // Flag as changed if the new scraped content meaningfully diverges on keywords
  const changedKeywords = keywords.filter(kw => {
    const inOld = oldText.includes(kw);
    const inNew = newText.includes(kw);
    return inOld !== inNew; // keyword presence changed
  });
  return changedKeywords.length >= 2; // require at least 2 keyword changes to avoid noise
};

/**
 * Refresh all airline policies via Firecrawl.
 * Stores scraped markdown alongside existing structured data.
 * Flags changeDetectedAt if policy appears to have changed.
 * Returns array of { code, changed, scraped } results.
 */
const refreshAllPolicies = async () => {
  console.log('[policyAgent] Starting weekly policy refresh...');
  const results = [];

  for (const code of Object.keys(POLICY_URLS)) {
    try {
      const existing = await AirlinePolicy.findOne({ code });
      if (!existing) {
        console.warn(`[policyAgent] No DB record for ${code} — skipping`);
        results.push({ code, changed: false, scraped: false });
        continue;
      }

      const markdown = await scrapeAirlinePolicy(code);
      if (!markdown) {
        results.push({ code, changed: false, scraped: false });
        continue;
      }

      const changed = detectPolicyChange(existing, markdown);
      const update = {
        lastScraped: new Date(),
        'policies.scrapedMarkdown': markdown,
      };

      if (changed) {
        update.changeDetectedAt = new Date();
        console.log(`[policyAgent] ⚠️  Policy change detected for ${code}`);
      }

      await AirlinePolicy.findOneAndUpdate({ code }, update);
      results.push({ code, changed, scraped: true });

      // Be polite to Firecrawl — small delay between requests
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[policyAgent] Refresh error for ${code}: ${err.message}`);
      results.push({ code, changed: false, scraped: false, error: err.message });
    }
  }

  console.log('[policyAgent] Policy refresh complete.', results);
  return results;
};

/**
 * Get policy for a given airline (by IATA code or display name).
 * Returns the AirlinePolicy document or null.
 */
const getPolicyForAirline = async (airlineIdentifier) => {
  if (!airlineIdentifier) return null;
  const upper = airlineIdentifier.toUpperCase();
  // Try IATA code first
  let policy = await AirlinePolicy.findOne({ code: upper }).lean();
  if (policy) return policy;
  // Try display name (case-insensitive)
  policy = await AirlinePolicy.findOne({
    airline: { $regex: new RegExp(airlineIdentifier.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i') },
  }).lean();
  return policy || null;
};

/**
 * Return recently changed policies (changeDetectedAt within last 14 days).
 */
const getRecentPolicyChanges = async () => {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  return AirlinePolicy.find({ changeDetectedAt: { $gte: since } })
    .sort({ changeDetectedAt: -1 })
    .lean();
};

module.exports = {
  seedPolicies,
  refreshAllPolicies,
  getPolicyForAirline,
  getRecentPolicyChanges,
  scrapeAirlinePolicy,
  SEED_POLICIES,
};
