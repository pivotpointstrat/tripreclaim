/**
 * TripReclaim — Airline Policy Routes
 *
 * GET  /policy/:airlineCode  - Return policy for an airline (IATA code or name)
 * POST /policy/refresh       - Trigger fresh Firecrawl scrape of all policies
 * GET  /policy/changes       - Return recently detected policy changes
 */

const express = require('express');
const router = express.Router();
const AirlinePolicy = require('../models/AirlinePolicy');
const { requireAuth } = require('../middleware/auth');
const {
  getPolicyForAirline,
  refreshAllPolicies,
  getRecentPolicyChanges,
  seedPolicies,
} = require('../services/policyAgent');

/**
 * GET /policy/changes
 * Returns policies with changeDetectedAt within the last 14 days.
 * Must be declared BEFORE /:airlineCode to avoid being swallowed by that route.
 */
router.get('/changes', requireAuth, async (req, res) => {
  try {
    const changes = await getRecentPolicyChanges();
    res.json({ changes });
  } catch (err) {
    console.error('[policy] Error fetching changes:', err.message);
    res.status(500).json({ error: 'Failed to fetch policy changes' });
  }
});

/**
 * GET /policy/all
 * Returns all stored airline policies (lightweight, no scraped markdown).
 */
router.get('/all', async (req, res) => {
  try {
    const policies = await AirlinePolicy.find()
      .select('-policies.scrapedMarkdown')
      .sort({ airline: 1 })
      .lean();
    res.json({ policies });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch policies' });
  }
});

/**
 * POST /policy/refresh
 * Admin-triggered: re-scrape all airline policy pages via Firecrawl.
 * Protected by auth. In production, restrict to admin role.
 */
router.post('/refresh', requireAuth, async (req, res) => {
  try {
    console.log(`[policy] Manual refresh triggered by user ${req.user._id}`);
    // Run async — respond immediately so the HTTP call doesn't time out
    res.json({ message: 'Policy refresh started. Check logs for progress.' });
    // Fire-and-forget (errors logged internally)
    refreshAllPolicies().catch(err =>
      console.error('[policy] Background refresh error:', err.message)
    );
  } catch (err) {
    res.status(500).json({ error: 'Failed to trigger refresh' });
  }
});

/**
 * POST /policy/seed
 * (Re-)seed the static research data into MongoDB.
 * Safe to call multiple times — uses $setOnInsert.
 */
router.post('/seed', requireAuth, async (req, res) => {
  try {
    const count = await seedPolicies();
    res.json({ message: `Seeded ${count} airline policies.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to seed policies' });
  }
});

/**
 * GET /policy/:airlineCode
 * Returns policy for an airline.
 * Accepts IATA code (e.g. UA, DL) OR display name (e.g. "United Airlines").
 */
router.get('/:airlineCode', async (req, res) => {
  try {
    const { airlineCode } = req.params;
    const policy = await getPolicyForAirline(airlineCode);
    if (!policy) {
      return res.status(404).json({
        error: `No policy found for "${airlineCode}". Supported codes: UA, AA, DL, WN, AS, B6`,
      });
    }
    // Strip large scraped markdown from public response
    if (policy.policies) {
      delete policy.policies.scrapedMarkdown;
    }
    res.json({ policy });
  } catch (err) {
    console.error('[policy] Error fetching policy:', err.message);
    res.status(500).json({ error: 'Failed to fetch policy' });
  }
});

module.exports = router;
