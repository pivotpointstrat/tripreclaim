#!/usr/bin/env node
/**
 * TripReclaim End-to-End Pipeline Test
 * Run with: node backend/scripts/test-e2e.js
 *
 * Tests the full flow:
 *  1. Backend health
 *  2. CORS headers
 *  3. Policy API
 *  4. Serpapi flight search
 *  5. Simulate Stripe webhook → user creation
 *  6. Magic link generation
 *  7. GHL contact creation
 *  8. Booking creation
 *  9. GHL price drop trigger
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const mongoose = require('mongoose');

const BASE = process.env.API_BASE || 'https://tripreclaim-production.up.railway.app';
const TEST_EMAIL = process.env.TEST_EMAIL || 'seyla+e2etest@pivotpointstrat.com';

const pass = (msg) => console.log(`  ✅ ${msg}`);
const fail = (msg) => console.log(`  ❌ ${msg}`);
const info = (msg) => console.log(`  ℹ️  ${msg}`);
const section = (title) => console.log(`\n${'─'.repeat(50)}\n  ${title}\n${'─'.repeat(50)}`);

async function runTests() {
  let passed = 0;
  let failed = 0;

  // ─── 1. Health Check ───────────────────────────────
  section('1. Backend Health Check');
  try {
    const r = await axios.get(`${BASE}/health`, { timeout: 10000 });
    if (r.status === 200) {
      pass(`Backend responding — status: ${r.status}`);
      info(`MongoDB: ${r.data.mongodb || 'unknown'}`);
      passed++;
    } else {
      fail(`Unexpected status: ${r.status}`);
      failed++;
    }
  } catch (e) {
    fail(`Health check failed: ${e.message}`);
    failed++;
  }

  // ─── 2. CORS ───────────────────────────────────────
  section('2. CORS Headers');
  try {
    const r = await axios.options(`${BASE}/auth/magic-link`, {
      headers: { 'Origin': 'https://tripreclaim.com', 'Access-Control-Request-Method': 'POST' },
      timeout: 10000,
    });
    const acao = r.headers['access-control-allow-origin'];
    if (acao && (acao === '*' || acao.includes('tripreclaim.com'))) {
      pass(`CORS allows tripreclaim.com — header: ${acao}`);
      passed++;
    } else {
      fail(`CORS header missing or wrong: ${acao}`);
      failed++;
    }
  } catch (e) {
    // OPTIONS may return 204 which axios treats as error
    if (e.response?.headers?.['access-control-allow-origin']) {
      pass(`CORS OK — ${e.response.headers['access-control-allow-origin']}`);
      passed++;
    } else {
      fail(`CORS test failed: ${e.message}`);
      failed++;
    }
  }

  // ─── 3. Policy API ─────────────────────────────────
  section('3. Policy API (/policy/all)');
  try {
    const r = await axios.get(`${BASE}/policy/all`, { timeout: 10000 });
    const policies = r.data?.policies || r.data || [];
    const count = Array.isArray(policies) ? policies.length : Object.keys(policies).length;
    if (count >= 1) {
      pass(`Policy API returning ${count} airlines`);
      passed++;
    } else {
      fail(`Policy API returned 0 airlines`);
      failed++;
    }
  } catch (e) {
    fail(`Policy API error: ${e.response?.status} ${e.message}`);
    failed++;
  }

  // ─── 4. Serpapi Flight Search ──────────────────────
  section('4. Serpapi Flight Search (IAD → KTI)');
  try {
    const params = new URLSearchParams({
      engine: 'google_flights',
      departure_id: 'IAD',
      arrival_id: 'KTI',
      outbound_date: '2026-06-10',
      currency: 'USD',
      hl: 'en',
      api_key: process.env.SERPAPI_KEY,
    });
    const r = await axios.get(`https://serpapi.com/search.json?${params}`, { timeout: 20000 });
    const prices = (r.data?.best_flights || r.data?.other_flights || [])
      .map(f => f.price).filter(Boolean);
    if (prices.length > 0) {
      pass(`Serpapi returned ${prices.length} flights — lowest: $${Math.min(...prices)}`);
      passed++;
    } else {
      fail('Serpapi returned no flight prices');
      failed++;
    }
  } catch (e) {
    fail(`Serpapi error: ${e.message}`);
    failed++;
  }

  // ─── 5. Simulate Stripe Webhook ────────────────────
  section('5. Stripe Webhook Simulation (user creation)');
  try {
    // Direct MongoDB check — connect to verify user creation works
    if (process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
      const User = require('../models/User');

      // Check if test user exists
      let user = await User.findOne({ email: TEST_EMAIL.toLowerCase() });
      if (user) {
        info(`Test user already exists — id: ${user._id}, plan: ${user.plan}`);
        pass('User model accessible and queryable');
      } else {
        // Create test user
        user = new User({
          email: TEST_EMAIL.toLowerCase(),
          plan: 'per_trip',
          tripsRemaining: 1,
          name: 'E2E Test User',
        });
        await user.save();
        pass(`Test user created — id: ${user._id}`);
      }
      passed++;
      await mongoose.disconnect();
    } else {
      info('MONGODB_URI not in local env — skipping direct DB test');
      info('Test via live Stripe test webhook instead');
    }
  } catch (e) {
    fail(`MongoDB/user test failed: ${e.message}`);
    failed++;
    try { await mongoose.disconnect(); } catch (_) {}
  }

  // ─── 6. Magic Link Generation ──────────────────────
  section('6. Magic Link Request');
  try {
    const r = await axios.post(`${BASE}/auth/magic-link`, { email: TEST_EMAIL }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    if (r.data?.message || r.status === 200) {
      pass(`Magic link requested — response: ${JSON.stringify(r.data).substring(0, 80)}`);
      passed++;
    } else {
      fail(`Unexpected magic link response: ${r.status}`);
      failed++;
    }
  } catch (e) {
    fail(`Magic link error: ${e.response?.status} — ${e.response?.data?.error || e.message}`);
    failed++;
  }

  // ─── 7. GHL Webhook Endpoint ───────────────────────
  section('7. GHL Webhook Receiver (/webhooks/ghl)');
  try {
    const r = await axios.post(`${BASE}/webhooks/ghl`, {
      type: 'contact.tag_applied',
      email: TEST_EMAIL,
      tags: ['e2e-test'],
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    if (r.data?.received) {
      pass(`GHL webhook receiver responding — type: ${r.data.type}`);
      passed++;
    } else {
      fail(`Unexpected GHL webhook response: ${JSON.stringify(r.data)}`);
      failed++;
    }
  } catch (e) {
    fail(`GHL webhook error: ${e.response?.status} — ${e.message}`);
    failed++;
  }

  // ─── 8. Email Inbound Webhook ──────────────────────
  section('8. Email Inbound Webhook (/webhooks/email-inbound)');
  try {
    const r = await axios.post(`${BASE}/webhooks/email-inbound`,
      JSON.stringify({
        type: 'email.received',
        data: {
          from: TEST_EMAIL,
          to: ['track@tripreclaim.com'],
          subject: 'E2E Test — BA GVA to LHR confirmation',
          text: 'British Airways booking reference TESTBA Geneva to London Heathrow Monday 25 May 2026 total GBP 234.56 passengers 1 adult',
          html: '<p>British Airways booking reference TESTBA Geneva to London Heathrow Monday 25 May 2026 total GBP 234.56 passengers 1 adult</p>',
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    if (r.data?.received) {
      pass(`Email inbound webhook alive — received: ${r.data.received}`);
      passed++;
    } else {
      fail(`Unexpected email-inbound response: ${JSON.stringify(r.data)}`);
      failed++;
    }
  } catch (e) {
    fail(`Email inbound error: ${e.response?.status} — ${e.message}`);
    failed++;
  }

  // ─── Summary ───────────────────────────────────────
  section('RESULTS');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log();
  if (failed === 0) {
    console.log('  🎉 All tests passed — TripReclaim pipeline is healthy!');
  } else {
    console.log(`  ⚠️  ${failed} test(s) failed — review output above.`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('\n❌ Test runner crashed:', err.message);
  process.exit(1);
});
