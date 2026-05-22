/**
 * TripReclaim — Airline Policy Agent
 *
 * Maintains a knowledge base of airline refund/price-drop policies.
 * Policies are seeded from structured research data and can be refreshed
 * via Firecrawl scraping on a weekly schedule.
 *
 * MongoDB collection: AirlinePolicies
 */

const axios = require('axios');
const AirlinePolicy = require('../models/AirlinePolicy');

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_BASE    = 'https://api.firecrawl.dev/v1';

// ─────────────────────────────────────────────────────────────────────────────
// Structured seed data (from user research)
// ─────────────────────────────────────────────────────────────────────────────

const SEED_POLICIES = [
  {
    airline: 'United Airlines',
    code: 'UA',
    policies: {
      priceDropPolicy: 'Cancel & rebook OR use Change Flight tool in the United app/website to get the lower price.',
      twentyFourHourRule: 'Full cash refund available within 24 hours of booking for tickets purchased at least 7 days before departure.',
      basicEconomyRules: 'Basic Economy tickets are non-changeable and non-refundable after the 24-hour cancellation window.',
      awardTicketPolicy: 'MileagePlus award tickets can be changed; mile difference refunded immediately when rebooking at lower mileage.',
      claimSteps: [
        "Go to united.com > My Trips",
        "Select your reservation",
        "Click 'Change Flight'",
        "Re-select the same flight at the lower price",
        "Confirm — credit applied automatically",
      ],
      claimUrl: 'https://www.united.com/en/us/mytrips',
      claimPhone: '1-800-864-8331',
      creditExpiry: '1 year from original ticket issue date',
      cancellationFees: {},
      loopholes: [
        'Same-day change fee waived for MileagePlus Premier members.',
        'ETCs (Electronic Travel Certificates) can be applied to any United fare.',
      ],
    },
  },
  {
    airline: 'American Airlines',
    code: 'AA',
    policies: {
      priceDropPolicy: 'After 24h: change via app/online for trip credit (same fare class). Cancel for credit then rebook cheaper.',
      twentyFourHourRule: 'Full refund within 24 hours of booking if ticket was purchased at least 2 days before travel.',
      basicEconomyRules: 'Basic Economy tickets are non-changeable after the 24-hour window. No refund.',
      awardTicketPolicy: 'AAdvantage award: changing flight results in immediate mile-difference refund.',
      claimSteps: [
        "Go to aa.com > My Trips",
        "Enter booking ref and last name",
        "Select 'Change Trip'",
        "Re-select same flight at lower price",
        "Difference issued as trip credit",
      ],
      claimUrl: 'https://www.aa.com/en/home#/mytrips',
      claimPhone: '1-800-433-7300',
      creditExpiry: '1 year from original ticket issue date',
      cancellationFees: {},
      loopholes: [
        'Trip credits from cancelled bookings can be stacked on a new purchase.',
        'AAdvantage Platinum and above can waive change fees on most fares.',
      ],
    },
  },
  {
    airline: 'Delta Air Lines',
    code: 'DL',
    policies: {
      priceDropPolicy: 'Cancel via My Trips to receive eCredit, then rebook at the lower price immediately.',
      twentyFourHourRule: 'Full refund within 24 hours of booking if departure is at least 7 days away.',
      basicEconomyRules: 'Basic Economy: no changes or cancellations allowed after 24-hour window.',
      awardTicketPolicy: 'Award tickets: cancel to get miles refunded, then rebook at the lower mileage cost.',
      claimSteps: [
        "Go to delta.com > My Trips",
        "Select your flight",
        "Click 'Cancel Flight'",
        "Receive eCredit for the full amount paid",
        "Immediately rebook the same flight at the lower price",
      ],
      claimUrl: 'https://www.delta.com/us/en/my-trips/overview',
      claimPhone: '1-800-221-1212',
      creditExpiry: '1 year from original purchase date',
      cancellationFees: {},
      loopholes: [
        'Delta eCredits can be used for any Delta or partner flight.',
        'Medallion members enjoy no change fees on most fare classes.',
      ],
    },
  },
  {
    airline: 'Southwest Airlines',
    code: 'WN',
    policies: {
      priceDropPolicy: 'Most user-friendly policy: just rebook online at the lower fare and receive the difference as flight credit or refund.',
      twentyFourHourRule: 'Full cash refund within 24 hours of booking regardless of fare type.',
      basicEconomyRules: 'Wanna Get Away fares: non-refundable but fully changeable; difference issued as flight credit.',
      awardTicketPolicy: 'Points bookings: difference in points returned immediately to Rapid Rewards account.',
      claimSteps: [
        "Log in to your Southwest account at southwest.com",
        "Go to 'Change Flight'",
        "Select your reservation",
        "Re-select the same flights at the lower price",
        "Confirm — credit or points issued instantly",
      ],
      claimUrl: 'https://www.southwest.com/air/manage-reservation/index.html',
      claimPhone: '1-800-435-9792',
      creditExpiry: 'Flight credits: 1 year from original purchase. Rapid Rewards points: no expiry for active members.',
      cancellationFees: {},
      loopholes: [
        'No change fees on any fare (except Basic). Best flexible policy in the industry.',
        'Refundable Anytime/Business Select fares get actual cash refund to card when price drops.',
        'Rapid Rewards points never expire for active members.',
      ],
    },
  },
  {
    airline: 'Alaska Airlines',
    code: 'AS',
    policies: {
      priceDropPolicy: 'No change fees on Main/First/Premium/Award fares. Text or chat an agent to reprice the reservation.',
      twentyFourHourRule: 'Full refund within 24 hours of booking on most fare types.',
      basicEconomyRules: 'Saver fares: non-changeable and non-refundable after the 24-hour window.',
      awardTicketPolicy: 'Mileage Plan award tickets can be repriced; mile difference refunded.',
      claimSteps: [
        "Text Alaska Airlines at 82008 or use the online chat at alaskaair.com",
        "Request the agent to 'reprice' your reservation to the current lower fare",
        "OR: Book the new ticket at the lower price first, then cancel the original for credit",
      ],
      claimUrl: 'https://www.alaskaair.com/account/overview',
      claimPhone: '1-800-252-7522',
      creditExpiry: '1 year from original ticket issue date',
      cancellationFees: {},
      loopholes: [
        'Texting 82008 is often faster than calling — agents can reprice instantly.',
        'MVP Gold members can call the dedicated line for priority repricing.',
      ],
    },
  },
  {
    airline: 'JetBlue',
    code: 'B6',
    policies: {
      priceDropPolicy: 'Blue/Blue Plus/Blue Extra/Mint: change online and credit is auto-applied. Blue Basic: cancellation fee applies — only claim if drop exceeds fee.',
      twentyFourHourRule: 'Full refund within 24 hours of booking for all fare types.',
      basicEconomyRules: 'Blue Basic: $100 cancellation fee (Americas/Caribbean) or $200 (all other routes). Not worth claiming unless price drop exceeds the fee.',
      awardTicketPolicy: 'TrueBlue points bookings can be changed online; point difference returned immediately.',
      claimSteps: [
        "Log in to JetBlue at jetblue.com > Manage Trips",
        "Select your flight and click 'Change Flight'",
        "Re-select the same itinerary at the lower price",
        "Fare difference credited to your JetBlue account automatically",
      ],
      claimUrl: 'https://www.jetblue.com/manage-trips',
      claimPhone: '1-800-538-2583',
      creditExpiry: '1 year from original issue date',
      cancellationFees: { blueBasic: 100, blueBasicInternational: 200 },
      loopholes: [
        'Mosaic members have no change fees on Blue Basic.',
        'If the price dropped significantly, it may be worth paying the fee on Blue Basic.',
      ],
    },
  },
];

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
 * Uses upsert so it's safe to call multiple times.
 */
const seedPolicies = async () => {
  let seeded = 0;
  for (const policy of SEED_POLICIES) {
    await AirlinePolicy.findOneAndUpdate(
      { code: policy.code },
      { $setOnInsert: policy },
      { upsert: true, new: true }
    );
    seeded++;
  }
  console.log(`[policyAgent] Seeded ${seeded} airline policies.`);
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
