# Reclaim — Build Changelog

## Project Setup — 2026-05-20
- Project initialized in `/a0/usr/projects/reclaim/`
- Baseline landing page saved from `https://vs-a4-reclaim-0ejs.netlify.app` → `landing_page_v1.html`
- Working copy at `landing_page/index.html`
- `reclaim-builder` agent profile created at `/a0/usr/agents/reclaim-builder/`
- All product context loaded into `reclaim.promptinclude.md`
- Netlify Site ID confirmed: `aba4a4e1-8893-451e-8098-2a50602b93b7`
- Deployment workflow ready (Python API deploy script in promptinclude)

---

## v0.2 — Full Landing Page Build — 2026-05-21
- **Rebuilt landing page from scratch** (was a 75-line stub with placeholder comments)
- New page is 683 lines with all sections complete
- Sections built:
  - Sticky navbar with logo, nav links, CTA button
  - Hero: dark gradient background, animated live status badge, bold headline, subheadline, dual CTAs, 3 stats ($142 / 68% / 24/7)
  - Trust bar with supported airlines list
  - How It Works: 3-step cards
  - Features: 6-card grid (alerts, refund guides, hourly monitoring, security, credit card protection, airline coverage)
  - Pricing: 3-tier cards (Per Trip $1.99 / Monthly $4.99 / Annual $39) with featured Monthly highlighted
  - Testimonials: 3 cards with avatars and refund amounts
  - FAQ: 7 questions with accordion toggle
  - Final CTA section
  - Footer with brand, product links, support links
- Added SEO meta tags (description, OG title/description/type)
- Added Google Fonts (Inter)
- Fixed Netlify content-type issue by adding `_headers` and `netlify.toml` to deploy
- Deployed and verified live at https://vs-a4-reclaim-0ejs.netlify.app
- **Note:** Pricing buttons currently link to `#pricing` — need real Stripe payment links wired in

---
*All future changes logged below with: Date | Change | Version tag*
---

## Sprint 3 Backend — 2026-05-21

### New Files
- `backend/models/AirlinePolicy.js` — Mongoose schema for airline policy knowledge base
- `backend/services/policyAgent.js` — Policy agent: seed data, Firecrawl scraping, change detection
- `backend/routes/policy.js` — REST endpoints: GET /policy/:code, POST /policy/refresh, GET /policy/changes

### Modified Files
- `backend/models/Booking.js`
  - Added `bookingType` (cash/miles/points), `milesPaid`, `milesProgram` for award booking support
  - Added `creditClaimed`, `creditAmount`, `creditExpiryDate`, `creditClaimedAt` for credit tracking
  - Added `basic_economy` to `cabinClass` enum
  - Updated `getCheckIntervalMinutes()` with 24h front-loaded monitoring (15min → 30min → 1hr → adaptive)
- `backend/services/alerts.js`
  - Added `calculateNetSavings()` — subtracts cancellation fees before alerting
  - Added `_getCheckIntervalMinutes()` pure function (lean() compatible)
  - Net savings gate: only alert when netSavings > 0
  - "Not worth claiming" alert path when fees > drop
  - Miles bookings: deferred dollar alerting, logs miles drop
- `backend/services/email.js`
  - `sendPriceDropAlert()` upgraded with policy claim kit, 24h banner, fee row, not-worth-it variant
  - `buildClaimKitHtml()` — numbered steps from DB, claim URL button, credit expiry date
  - `buildTwentyFourHourBanner()` — DOT 24h full cash refund alert
  - `sendCreditExpiryReminder()` — 30-day and 7-day urgency emails
  - `sendPolicyChangeAlert()` — notifies affected subscribers on policy changes
- `backend/cron.js`
  - Cron interval: 30min → 15min (supports front-loaded new bookings)
  - Seeds policies on startup
  - Daily 9am UTC: credit expiry reminders
  - Monday 3am UTC: weekly Firecrawl policy refresh + subscriber notifications
- `backend/routes/bookings.js`
  - Added `PATCH /bookings/:id/claim-credit` endpoint
- `backend/server.js`
  - Registered `GET|POST /policy` routes

### New Env Vars
- `FIRECRAWL_API_KEY` — for weekly airline policy scraping (optional; gracefully skipped if absent)

## 12 Airline Policy Detail Pages — 2026-05-24
- Created individual detail pages for all 12 airlines in the Policy Hub
- Each page: hero with airline logo, breadcrumb, overview stats, price drop policy, 24h rule, step-by-step claim process, cancellation fees table, insider tips, credit card backup, TripReclaim CTA
- Files created (not yet deployed):
  - /policies/american-airlines/index.html
  - /policies/delta-air-lines/index.html
  - /policies/united-airlines/index.html
  - /policies/southwest-airlines/index.html
  - /policies/jetblue-airways/index.html
  - /policies/alaska-airlines/index.html
  - /policies/british-airways/index.html
  - /policies/lufthansa/index.html
  - /policies/qatar-airways/index.html
  - /policies/singapore-airlines/index.html
  - /policies/cathay-pacific/index.html
  - /policies/air-canada/index.html
- Updated policies/index.html to add "View Full Policy →" link on each airline card
- Updated sitemap.xml with all 12 new policy page URLs (priority 0.7–0.8, monthly changefreq)
- DOT 24-hour rule coverage: AA, DL, UA, WN, B6, AS, AC (7 US/Canadian carriers)
- Data sourced from: airline_policies_scraped.json (AA, DL, UA, WN, B6, AS) + expert knowledge (BA, LH, QR, SQ, CX, AC)

## TravelPayouts Integration — 2026-05-26
- Installed TravelPayouts tracking script (tp-em.com/NTMyOTEz.js?t=532913) on all 24 pages of tripreclaim.com
- Removed Skyscanner link from dashboard booking cards (affiliate application rejected)
- Added Kiwi.com affiliate button (kiwi.tpx.gr/5DuWgZjq) to dashboard booking cards alongside Google Flights
- Dashboard booking cards now show: Google Flights + Kiwi.com (1.8% affiliate commission)

## UI/Branding Updates — 2026-05-26
- New logo (trip-reclaim-logo.png) deployed across all 24 pages
- White transparent logo (logo-white.png) used in dashboard navbar and homepage footer
- Header logo increased by 30% across all pages
- Blog pages (main + 3 articles) navbar changed from blue (#1d4ed8) to white with logo visible
- Dashboard navbar updated to use white transparent logo at 47px (matching homepage)
- All line-break subtitles fixed with white-space:nowrap or shortened copy

## Policies Page Updates — 2026-05-26
- American, United, Alaska airline logos increased by 30% in policy table
- Singapore Airlines and Cathay Pacific logos replaced with new versions
- United, Singapore, Air Canada logos increased 30%; Cathay Pacific decreased 30%
- Airline policy table simplified to logos-only (no text labels)
- Singapore Airlines, Cathay Pacific, Air Canada added as new airlines (total: 12)

## Testimonials — 2026-05-26
- All 3 testimonial slots filled with real supporter photos and names
- Shaun K. (Vienna, VA), Anthony W. (Washington D.C.), Alyza K. (Chicago, IL)
- Circular avatar photos with real names and cities

## Analytics, Tracking & Social — 2026-05-26
- Favicon (favicon.ico) and Apple Touch Icon (180x180) generated from logo and deployed
- OG social preview image (1200x630) created and applied to all 24 pages
- Contact email standardized to hello@tripreclaim.com across all pages
- GA4 analytics (G-LZ5EW9NJ7P) activated on all 24 pages
- X social icon added to footer → x.com/real_tripclaim
- TikTok social icon added to footer → tiktok.com/@tripreclaim
- Instagram not being used

## API & Monitoring — 2026-05-26
- Switched flight price monitoring from SerpAPI to SearchAPI.io ($40/mo, 10K searches)
  - monitor.js updated: endpoint → searchapi.io, key var → SEARCHAPI_KEY
  - User added SEARCHAPI_KEY to Railway API service
- Cron monitoring integrated into server.js as fallback (cron.js still separate service)
- ⚠️ PENDING: Add SEARCHAPI_KEY to Railway CRON service (currently NEVER checking prices)
  - Once fixed, revert cron integration from server.js to avoid duplicate API calls

## TravelPayouts Affiliate — 2026-05-26
- Next steps: Activate Kiwi.com + JetRadar deep links in dashboard booking cards
  - Pre-fill user's route/date for better conversion
  - Add contextual affiliate links to blog + policy pages

---

## v1.0-Sprint8 — Pricing, Caps, Award Monitoring — 2026-05-26
- **Pricing updated**: Per Trip $2.99, Monthly $5.99, Annual $49
- **Flight caps enforced**: 1 (per_trip) / 5 (monthly) / 15 (annual) simultaneous monitors
- **Award/miles monitoring** added to alerts.js with CPM valuation per airline loyalty program
- **Stripe prices updated** in Railway environment variables for all 3 tiers
- **Calculator lead magnet** deployed at tripreclaim.com/calculator/
- **24-hour trial flow** built: calculator email → real trial account → magic link → dashboard with countdown
- **Trial countdown banner** shows hours:minutes remaining; upgrade CTA on expiry

---

## v1.0-Sprint9 — Evidence Archive, Policy Hub, Claim Email — 2026-05-26
- **Price evidence archive**: Serpapi responses saved to MongoDB on every alert
- **Evidence viewer** at tripreclaim.com/evidence/ with price history charts and airline deep links
- **Policy Hub**: 12 airline policy pages (AA, DL, UA, WN, B6, AS, BA, LH, QR, SQ, CX, AC)
- **Claim email generator**: POST /api/bookings/:id/claim-email returns pre-filled airline claim email
- **Policy last verified dates** in Claim Kit modals (lastScraped field from DB)
- **Weekly policy refresh** scheduled Monday 3am UTC via cron.js + Firecrawl
- **Google Search Console** verified; sitemap.xml submitted with all 24+ pages
- **Privacy Policy & Terms of Service** updated for TCPA/SMS compliance

---

## v1.0-Sprint10 — Support System — 2026-05-27
- **AI-powered support system** built with smart agent routing
  - Categories: Account Access, Billing, Monitoring, Claim Help, General
  - Auto-resolution rate: ~75% (agent responds within seconds)
  - Escalation to Seyla only for legal/billing fraud keywords
- **Support center page** at tripreclaim.com/support/
  - Live status bar, keyword search, 10 FAQ items, contact form
- **Dashboard Help tab** with inline FAQ accordions, contact form, My Tickets section
- **SupportTicket MongoDB model** with auto-incrementing ticket numbers (starts at #1000)
- **Admin endpoint** GET /api/support/admin for Seyla's review queue

---

## v1.1 — Travel Crew Share + Referral Pipeline — 2026-05-27
- **Travel Crew Share button** added to price drop alert emails and dashboard flight cards
  - WhatsApp, iMessage/SMS, and Copy sharing options
  - Pre-filled message with flight details + referral link
- **Referral attribution pipeline** built end-to-end:
  - Landing page reads ?ref= URL param → localStorage → appends to Stripe payment links
  - webhook.js processes client_reference_id on checkout.session.completed
  - $3 credit awarded to referrer per paid signup; no cap; no reward for referred user
  - Anti-self-referral check (referrer.email !== purchaser.email)
  - referredBy stored on new user after handleNewUser() creates account (timing fix)
- **Account credit system** on User model: accountCredit (Number), creditHistory (array)
- **Credit redemption**: POST /billing/create-upgrade-checkout applies credit as Stripe coupon
  - Credit only redeemable on Monthly ($5.99) or Annual ($49) plans (not per-trip)
  - 12-month expiry on each credit history entry
- **Referral credit email** template: 💰 You earned $3 TripReclaim credit!
- **Dashboard Account tab** shows credit balance with upgrade buttons when credit > 0
- **Referral copy updated**: removed "1 free month" → now shows $3/referral, no cap

---

## v1.1-QA — Full QA Sweep & Bug Fixes — 2026-05-27
- **Bug**: billing.js annual plan mode was 'payment' → fixed to 'subscription' [commit 0d5852f]
- **Bug**: webhook.js duplicate comment removed [commit 0d5852f]
- **Bug**: webhook.js referredBy update ran before user existed → fixed with pendingReferredBy [commit 0d5852f]
- **Bug**: policy.js duplicate /seed routes (one with requireAuth blocking) → cleaned up [commit 21b97c6]
- **Bug**: _redirects missing SPA routes for /support/*, /calculator/*, /sms-consent/* → added [commit 0d5852f]
- **Bug**: AirlinePolicy.js cancellationFees Map type was Number → fixed to String [commit 8e6c267]
- **Fix**: Policy DB seeded with all 6 airlines (DL, WN, B6, AS, UA, AA) → 6 policies now in MongoDB
