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
