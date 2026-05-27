/**
 * TripReclaim — GDPR/CCPA Cookie Consent Banner
 * Uses Google Consent Mode v2 to control GA4 analytics_storage
 * Stores choice in localStorage as 'tr_cookie_consent' ('accepted' | 'declined')
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'tr_cookie_consent';
  var GA_ID = 'G-LZ5EW9NJ7P';

  // ── Google Consent Mode v2 helpers ──
  function updateConsent(granted) {
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        'analytics_storage': granted ? 'granted' : 'denied',
        'ad_storage': 'denied' // We don't run ads — always denied
      });
    }
  }

  // ── Apply saved preference immediately (before banner renders) ──
  var saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'accepted') {
    updateConsent(true);
  }

  // ── If already decided, nothing more to do ──
  if (saved) return;

  // ── Inject banner CSS ──
  var style = document.createElement('style');
  style.textContent = [
    '#tr-cookie-banner {',
    '  position: fixed;',
    '  bottom: 0; left: 0; right: 0;',
    '  z-index: 99999;',
    '  background: #0f172a;',
    '  color: #e2e8f0;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  font-size: 14px;',
    '  line-height: 1.5;',
    '  box-shadow: 0 -4px 24px rgba(0,0,0,0.3);',
    '  border-top: 2px solid #1d4ed8;',
    '  transform: translateY(100%);',
    '  transition: transform 0.35s ease;',
    '}',
    '#tr-cookie-banner.tr-banner-visible { transform: translateY(0); }',
    '#tr-cookie-inner {',
    '  max-width: 1100px;',
    '  margin: 0 auto;',
    '  padding: 14px 20px;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  gap: 16px;',
    '  flex-wrap: wrap;',
    '}',
    '#tr-cookie-text { flex: 1; min-width: 240px; }',
    '#tr-cookie-text a { color: #60a5fa; text-decoration: underline; }',
    '#tr-cookie-text a:hover { color: #93c5fd; }',
    '#tr-cookie-actions {',
    '  display: flex;',
    '  gap: 10px;',
    '  flex-shrink: 0;',
    '}',
    '.tr-cookie-btn {',
    '  padding: 8px 20px;',
    '  border-radius: 6px;',
    '  font-size: 13px;',
    '  font-weight: 600;',
    '  cursor: pointer;',
    '  border: none;',
    '  letter-spacing: 0.01em;',
    '  transition: opacity 0.15s;',
    '}',
    '.tr-cookie-btn:hover { opacity: 0.88; }',
    '#tr-cookie-accept {',
    '  background: #1d4ed8;',
    '  color: #fff;',
    '}',
    '#tr-cookie-decline {',
    '  background: transparent;',
    '  color: #94a3b8;',
    '  border: 1px solid #334155 !important;',
    '}',
    '@media (max-width: 600px) {',
    '  #tr-cookie-inner { flex-direction: column; align-items: flex-start; }',
    '  #tr-cookie-actions { width: 100%; }',
    '  .tr-cookie-btn { flex: 1; text-align: center; }',
    '}'
  ].join('\n');
  document.head.appendChild(style);

  // ── Inject banner HTML ──
  var banner = document.createElement('div');
  banner.id = 'tr-cookie-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Cookie consent');
  banner.innerHTML = [
    '<div id="tr-cookie-inner">',
    '  <div id="tr-cookie-text">',
    '    We use analytics cookies to understand how visitors use TripReclaim and improve your experience.',
    '    <a href="/privacy/" target="_blank">Privacy Policy</a>',
    '  </div>',
    '  <div id="tr-cookie-actions">',
    '    <button class="tr-cookie-btn" id="tr-cookie-decline">Decline</button>',
    '    <button class="tr-cookie-btn" id="tr-cookie-accept">Accept Cookies</button>',
    '  </div>',
    '</div>'
  ].join('');
  document.body.appendChild(banner);

  // ── Animate in after paint ──
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      banner.classList.add('tr-banner-visible');
    });
  });

  // ── Accept handler ──
  document.getElementById('tr-cookie-accept').addEventListener('click', function () {
    localStorage.setItem(STORAGE_KEY, 'accepted');
    updateConsent(true);
    banner.classList.remove('tr-banner-visible');
    setTimeout(function () { banner.remove(); }, 400);
  });

  // ── Decline handler ──
  document.getElementById('tr-cookie-decline').addEventListener('click', function () {
    localStorage.setItem(STORAGE_KEY, 'declined');
    updateConsent(false);
    banner.classList.remove('tr-banner-visible');
    setTimeout(function () { banner.remove(); }, 400);
  });

})();
