/* Shared front-end for the /download/ store pages.
 * Talks ONLY to our /api endpoints; prices and file URLs are always
 * server-decided. No Stripe key, no bucket name, no file paths here.
 */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  async function api(path, options) {
    const res = await fetch(path, Object.assign({ headers: { accept: 'application/json' } }, options));
    let body = null;
    try { body = await res.json(); } catch (e) { /* non-JSON error */ }
    return { status: res.status, body };
  }

  function formatPrice(price) {
    if (!price || typeof price.amount !== 'number') return '';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency.toUpperCase() })
        .format(price.amount / 100);
    } catch (e) {
      return (price.amount / 100).toFixed(2) + ' ' + price.currency.toUpperCase();
    }
  }

  function detectPlatform() {
    const ua = navigator.userAgent || '';
    const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    if (/mac/i.test(p) || /Macintosh/.test(ua)) return 'macos';
    if (/win/i.test(p) || /Windows/.test(ua)) return 'windows';
    return null;
  }

  function fillIdentity(cfg) {
    if (!cfg) return;
    $$('[data-support]').forEach((el) => {
      if (cfg.supportEmail) { el.textContent = cfg.supportEmail; el.href = 'mailto:' + cfg.supportEmail; }
    });
    $$('[data-seller]').forEach((el) => { if (cfg.sellerName) el.textContent = cfg.sellerName; });
  }

  /* ── store page ─────────────────────────────────────────────────────── */
  async function initStore() {
    const buyBtns = $$('[data-buy]');
    const priceEls = $$('[data-price]');
    const state = $('#storeState');

    if (new URLSearchParams(location.search).get('cancelled') === '1') {
      const note = $('#cancelledNote');
      if (note) note.classList.remove('hidden');
    }

    const { body: cfg } = await api('/api/store-config');
    if (!cfg) { if (state) state.textContent = 'Store is temporarily unavailable.'; return; }

    fillIdentity(cfg);

    const reco = detectPlatform();
    $$('.dl-card').forEach((card) => {
      if (reco && card.dataset.platform === reco) card.classList.add('reco');
    });

    if (!cfg.commerceEnabled) {
      priceEls.forEach((el) => { el.textContent = 'Coming soon'; });
      buyBtns.forEach((b) => { b.disabled = true; b.textContent = 'Not on sale yet'; });
      if (state) state.textContent = 'Purchasing is not open yet. Check back soon.';
      return;
    }

    const priceText = formatPrice(cfg.price);
    priceEls.forEach((el) => { el.textContent = priceText; });
    buyBtns.forEach((btn) => {
      btn.disabled = false;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Opening secure checkout…';
        const { status, body } = await api('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: '{}',
        });
        if (status === 200 && body && body.url) { location.href = body.url; return; }
        btn.disabled = false;
        btn.textContent = 'Buy now';
        if (state) {
          state.textContent = status === 429
            ? 'Too many attempts — please wait a minute and try again.'
            : 'Could not start checkout. Please try again or contact support.';
        }
      });
    });
  }

  /* ── success page ───────────────────────────────────────────────────── */
  async function initSuccess() {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session_id');
    const restored = params.get('restored') === '1';
    const wait = $('#waitState');
    const ready = $('#readyState');
    const fail = $('#failState');

    function showReady() {
      wait.classList.add('hidden');
      ready.classList.remove('hidden');
      const reco = detectPlatform();
      $$('.dl-card').forEach((card) => {
        if (reco && card.dataset.platform === reco) card.classList.add('reco');
      });
    }

    if (restored) { showReady(); }
    else if (sessionId) {
      // Stripe redirects here possibly before the webhook lands — poll briefly.
      let delay = 1000;
      for (let attempt = 0; attempt < 8; attempt++) {
        const { status, body } = await api('/api/checkout-status?session_id=' + encodeURIComponent(sessionId));
        if (status === 200 && body && body.status === 'paid') { showReady(); return void wireDownloads(); }
        if (status === 200 && body && body.status === 'refunded') break;
        if (status === 404 || status === 400) break;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 1.7, 8000);
      }
      wait.classList.add('hidden');
      fail.classList.remove('hidden');
      return;
    } else {
      wait.classList.add('hidden');
      fail.classList.remove('hidden');
      return;
    }
    wireDownloads();
  }

  function wireDownloads() {
    $$('.dl-card [data-download]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.dl-card');
        const meta = card.querySelector('.meta');
        const original = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = '<span class="spin"></span>Preparing…';
        const { status, body } = await api('/api/download-link', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ platform: card.dataset.platform, arch: card.dataset.arch }),
        });
        btn.disabled = false;
        btn.textContent = original;
        if (status === 200 && body && body.url) {
          if (meta) {
            meta.textContent = body.fileName + ' · ' + (body.size / (1024 * 1024)).toFixed(1) + ' MB · SHA-256 '
              + body.sha256.slice(0, 16) + '…';
            meta.title = 'SHA-256: ' + body.sha256;
          }
          location.href = body.url; // short-lived signed URL
        } else if (status === 401) {
          location.href = '../restore/';
        } else if (meta) {
          meta.textContent = status === 429
            ? 'Too many requests — wait a minute and try again.'
            : (body && body.error) || 'Download unavailable right now.';
        }
      });
    });
  }

  /* ── restore page ───────────────────────────────────────────────────── */
  function initRestore() {
    const form = $('#restoreForm');
    const done = $('#restoreDone');
    const err = $('#restoreError');
    if (new URLSearchParams(location.search).get('error') === 'link') {
      err.classList.remove('hidden');
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>Sending…';
      const { status, body } = await api('/api/request-download-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email: $('#email', form).value }),
      });
      btn.disabled = false;
      btn.textContent = 'Email my download link';
      if (status === 200) {
        form.classList.add('hidden');
        done.classList.remove('hidden');
        if (body && body.localTestUrl) {
          const a = document.createElement('a');
          a.href = body.localTestUrl;
          a.textContent = 'Local test link';
          done.appendChild(document.createElement('br'));
          done.appendChild(a);
        }
      } else {
        err.textContent = status === 429
          ? 'Too many attempts — please wait an hour and try again.'
          : 'Something went wrong. Please try again or contact support.';
        err.classList.remove('hidden');
      }
    });
  }

  const page = document.body.dataset.page;
  if (page === 'store') initStore();
  else if (page === 'success') initSuccess();
  else if (page === 'restore') initRestore();
  if (page !== 'store') {
    api('/api/store-config').then(({ body }) => fillIdentity(body)).catch(() => {});
  }
})();
