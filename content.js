/**
 * content.js — PUC portal scraper
 *
 * Extraction is attempted in this order for every field:
 *   Layer 1a  PRIMARY_SELECTOR   — specific DOM ID from the registry
 *   Layer 1b  FALLBACK_SELECTOR  — attribute-based fallback selectors
 *   Layer 2   REGEX              — data-shape pattern on full page text (self-healing)
 *   Layer 3   LABEL              — label-text proximity search (most resilient)
 *
 * The registry is managed by platform admins and polled by the background
 * service worker every 30 minutes (ETag-gated).  When the portal updates its DOM,
 * an admin can fix selectors without shipping a new extension version.
 *
 * Anomalous telemetry events (fallback usage or failures) are buffered in
 * chrome.storage.local.  The background worker flushes this buffer to
 * POST /scraper/telemetry after each successful save, giving the admin
 * dashboard visibility into selector health without adding save latency.
 */

(() => {
  if (!window.location.href.includes('pucCertificateNew.xhtml')) return;

  // ── Default config (used when registry is unreachable or not yet fetched) ──
  // Mirrors the seeded rows in migration 020.  Version 0 signals "built-in
  // default" so the admin dashboard can distinguish it from registry-sourced data.
  const DEFAULT_CONFIG = {
    vehicleNo: {
      primary_selector:   '#j_idt34',
      fallback_selectors: ["[id$='vehicleNo']", "[id*='vehicle']"],
      regex_pattern:      '[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}',
      label_hint:         'Vehicle No',
      config_version:     0,
    },
    validDate: {
      primary_selector:   '#j_idt17',
      fallback_selectors: ["[id$='validDate']", "[id*='issueDate']"],
      regex_pattern:      null,
      label_hint:         'Date of Issue',
      config_version:     0,
    },
    uptoDate: {
      primary_selector:   '#j_idt25',
      fallback_selectors: ["[id$='uptoDate']", "[id*='expiryDate']", "[id*='validUpto']"],
      regex_pattern:      null,
      label_hint:         'Valid Upto',
      config_version:     0,
    },
    rate: {
      primary_selector:   '#feesID',
      fallback_selectors: ["[id*='fees']", "[id*='rate']", "[id*='amount']"],
      regex_pattern:      '(?:Rs\\.?\\s*)?(\\d+)',
      label_hint:         'Fee',
      config_version:     0,
    },
  };

  // ── Layer 3: label-proximity search ────────────────────────────────────────
  /**
   * Walk all text nodes; when one contains labelHint (exact word boundary match),
   * inspect sibling/parent elements for a non-empty value.
   *
   * valueRegex is always required — it guards against returning an adjacent label
   * text instead of the actual field value.  Without it, two neighbouring labels
   * ("Vehicle No" next to "Owner Name") can cause cross-field contamination.
   */
  function findNearLabel(labelHint, valueRegex) {
    if (!valueRegex) return null; // refuse to run without a format guard
    const hint = labelHint.toLowerCase();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const nodeText = node.textContent.trim().toLowerCase();
      // Require the hint to be the whole text node or a label-like substring,
      // not just contained anywhere (avoids matching partial words in longer sentences).
      if (!nodeText.includes(hint)) continue;

      const parent = node.parentElement;
      if (!parent) continue;

      // Try: next sibling element
      const next = parent.nextElementSibling;
      if (next) {
        const text = (next.innerText || next.textContent || '').trim();
        if (text && valueRegex.test(text)) return text;
      }

      // Try: parent's next sibling
      const parentNext = parent.parentElement && parent.parentElement.nextElementSibling;
      if (parentNext) {
        const text = (parentNext.innerText || parentNext.textContent || '').trim();
        if (text && valueRegex.test(text)) return text;
      }

      // Try: nearest td in the same table row
      const td = parent.closest('td');
      if (td && td.nextElementSibling) {
        const text = (td.nextElementSibling.innerText || td.nextElementSibling.textContent || '').trim();
        if (text && valueRegex.test(text)) return text;
      }
    }
    return null;
  }

  // ── Core extraction ─────────────────────────────────────────────────────────
  /**
   * Attempt all four strategies in order.
   * Returns { value, strategy, config_version } — value is null only if all fail.
   */
  function extractField(fieldConfig) {
    const {
      primary_selector,
      fallback_selectors,
      regex_pattern,
      label_hint,
      config_version,
    } = fieldConfig;

    // Layer 1a: Primary selector
    try {
      const el   = primary_selector && document.querySelector(primary_selector);
      const text = el && (el.innerText || el.textContent || '').trim();
      if (text) return { value: text, strategy: 'PRIMARY_SELECTOR', config_version };
    } catch (_) { /* invalid selector syntax — fall through */ }

    // Layer 1b: Fallback selectors
    for (const sel of (fallback_selectors || [])) {
      try {
        const el   = document.querySelector(sel);
        const text = el && (el.innerText || el.textContent || '').trim();
        if (text) return { value: text, strategy: 'FALLBACK_SELECTOR', config_version };
      } catch (_) { /* invalid selector syntax — skip */ }
    }

    // Layer 2: Regex on full page text
    if (regex_pattern) {
      try {
        const re       = new RegExp(regex_pattern, 'g');
        const pageText = document.body.innerText || '';
        const matches  = [...pageText.matchAll(re)];
        if (matches.length > 0) {
          // Prefer the match closest to the label in the DOM — this avoids
          // picking up the vehicle number from the search box instead of the
          // certificate result when the same pattern appears multiple times.
          let value = null;
          if (label_hint) {
            value = findNearLabel(label_hint, re);
          }
          // Fall back to first global match only when label proximity also failed.
          if (!value) value = matches[0][1] || matches[0][0]; // capture group 1 if present
          if (value) return { value, strategy: 'REGEX', config_version };
        }
      } catch (_) { /* bad regex — fall through */ }
    }

    // Layer 3: Label proximity with regex format guard.
    // If no regex is defined for this field (e.g. dates), build a permissive
    // guard that rejects obviously wrong values (empty strings, whitespace-only).
    if (label_hint) {
      const guard = regex_pattern ? (() => { try { return new RegExp(regex_pattern); } catch (_) { return null; } })() : /\S/;
      if (guard) {
        const value = findNearLabel(label_hint, guard);
        if (value) return { value, strategy: 'LABEL', config_version };
      }
    }

    return { value: null, strategy: 'FAILED', config_version };
  }

  // ── Main async IIFE ─────────────────────────────────────────────────────────
  (async function run() {
    // Load registry config from storage (populated by background service worker).
    // Falls back to DEFAULT_CONFIG if nothing cached yet.
    let fieldConfigs = DEFAULT_CONFIG;
    try {
      const stored = await chrome.storage.local.get(['scraperConfig']);
      if (stored.scraperConfig && typeof stored.scraperConfig === 'object') {
        // Merge: registry values override defaults; missing fields use defaults.
        fieldConfigs = Object.assign({}, DEFAULT_CONFIG, stored.scraperConfig);
      }
    } catch (_) { /* storage unavailable — use defaults */ }

    // Extract all four fields, recording which strategy worked.
    const results         = {};
    const telemetryEvents = [];
    const now             = new Date().toISOString();

    for (const field of ['vehicleNo', 'validDate', 'uptoDate', 'rate']) {
      const config = fieldConfigs[field] || DEFAULT_CONFIG[field];
      const { value, strategy, config_version } = extractField(config);
      results[field] = value;
      telemetryEvents.push({
        field_name:        field,
        strategy,
        success:           !!value,
        config_version,
        scraped_at:        now,
      });
    }

    // Only buffer anomalous events — fallback usage or outright failures.
    // Successful primary-selector hits are the happy path and produce no telemetry:
    // they add noise to the dashboard and storage overhead with zero diagnostic value.
    const anomalous = telemetryEvents.filter(
      e => !e.success || e.strategy !== 'PRIMARY_SELECTOR'
    );
    if (anomalous.length > 0) {
      try {
        const existing = await chrome.storage.local.get(['telemetryBuffer']);
        const buffer   = (existing.telemetryBuffer || []).concat(anomalous);
        // Cap at 500 events to bound storage usage; evict oldest.
        await chrome.storage.local.set({ telemetryBuffer: buffer.slice(-500) });
      } catch (_) { /* non-fatal */ }
    }

    // Bail if we couldn't identify the vehicle — nothing useful to save.
    if (!results.vehicleNo) return;

    const rawRate     = (results.rate || '').replace(/Rs\.?\s*/i, '').trim();
    const missingFields = [];
    if (!results.validDate) missingFields.push('validDate');
    if (!results.uptoDate)  missingFields.push('uptoDate');

    chrome.runtime.sendMessage({
      type: 'SCRAPED_DATA',
      payload: {
        vehicleNo:     results.vehicleNo,
        validDate:     results.validDate,
        uptoDate:      results.uptoDate,
        rate:          rawRate,
        missingFields,
      },
    });
  })();
})();
