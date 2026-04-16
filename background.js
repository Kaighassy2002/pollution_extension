import { MSG, STORAGE, DEFAULT_BACKEND_URL, GOOGLE_SHEETS_CLIENT_ID } from './utils/constants.js';
import { refreshSheetsTokenIfPossible } from './utils/api.js';
import { formatRecordForBackend }                          from './utils/date.js';
import { localGet, localSet, syncGet, syncSet }            from './utils/storage.js';
import { saveRecord, getGoogleUserEmail, createSheetsSpreadsheet, verifySheetsSpreadsheet, findExistingGreenLeafSheet } from './utils/api.js';

// ─── Scraper config polling ───────────────────────────────────────────────────

const CONFIG_POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch the selector registry from the backend (ETag-gated).
 * Stores result in chrome.storage.local so content.js can read it synchronously.
 * Safe to call on every startup — returns immediately on 304 (nothing changed).
 */
async function refreshScraperConfig() {
  try {
    // Read ETag + timestamp in one call. BACKEND_URL is read from sync storage
    // only inside saveRecord/sendToBackend (which already do that); here we use
    // DEFAULT_BACKEND_URL to avoid an extra async sync-storage roundtrip on every
    // service-worker startup.
    const local      = await localGet([STORAGE.SCRAPER_CONFIG_ETAG, STORAGE.SCRAPER_CONFIG_AT]);
    const storedEtag = local[STORAGE.SCRAPER_CONFIG_ETAG];
    const fetchedAt  = local[STORAGE.SCRAPER_CONFIG_AT] || 0;
    const baseUrl    = DEFAULT_BACKEND_URL;

    // Skip if we fetched recently (avoids hammering on rapid service-worker restarts)
    if (storedEtag && Date.now() - fetchedAt < CONFIG_POLL_INTERVAL_MS) return;

    const headers = { 'Content-Type': 'application/json' };
    if (storedEtag) headers['If-None-Match'] = storedEtag;

    const res = await fetch(`${baseUrl}/scraper/config`, { headers });

    if (res.status === 304) {
      // Config unchanged — just update the fetch timestamp so we don't retry for 30 min
      await localSet({ [STORAGE.SCRAPER_CONFIG_AT]: Date.now() });
      return;
    }

    if (!res.ok) return; // backend unreachable — silently keep cached config

    const json   = await res.json().catch(() => null);
    const newEtag = res.headers.get('ETag');

    if (!json || !json.success || !Array.isArray(json.data?.configs)) return;

    // Reshape array → { fieldName: configObject } keyed map for content.js lookup
    const configMap = {};
    for (const cfg of json.data.configs) {
      configMap[cfg.field_name] = {
        primary_selector:   cfg.primary_selector   || null,
        fallback_selectors: cfg.fallback_selectors || [],
        regex_pattern:      cfg.regex_pattern      || null,
        label_hint:         cfg.label_hint         || null,
        config_version:     cfg.config_version     || 1,
      };
    }

    await localSet({
      [STORAGE.SCRAPER_CONFIG]:      configMap,
      [STORAGE.SCRAPER_CONFIG_ETAG]: newEtag || null,
      [STORAGE.SCRAPER_CONFIG_AT]:   Date.now(),
    });
  } catch (_) {
    // Network error, CORS, etc. — silently keep cached config.
    // The extension must always be able to scrape even when the backend is down.
  }
}

// ─── Telemetry flush ──────────────────────────────────────────────────────────

/**
 * Flush buffered telemetry events to POST /scraper/telemetry.
 * Called after a successful save so the admin dashboard reflects real-world
 * selector health without adding latency to the scrape itself.
 *
 * Events stay buffered on failure and will be retried on the next flush.
 * The buffer is capped at 500 entries in content.js; here we send at most 200
 * per call to stay within the backend's max_length constraint.
 */
async function flushTelemetry() {
  try {
    const syncData = await syncGet([STORAGE.AUTH_TOKEN, STORAGE.GREENLEAF_CONNECTED]);

    if (!syncData[STORAGE.GREENLEAF_CONNECTED]) return; // no auth — skip silently
    const token = syncData[STORAGE.AUTH_TOKEN];
    if (!token) return;

    // Read the buffer immediately before the network call so we know exactly
    // which events we're about to send.  After a successful flush we remove
    // precisely those events — not a stale snapshot read earlier — which
    // eliminates the race where a SW restart between read and write causes events
    // to be silently dropped.
    const localData = await localGet([STORAGE.TELEMETRY_BUFFER]);
    const buffer    = localData[STORAGE.TELEMETRY_BUFFER] || [];
    if (buffer.length === 0) return;

    const batch = buffer.slice(0, 200);
    const res   = await fetch(`${DEFAULT_BACKEND_URL}/scraper/telemetry`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ events: batch }),
    });

    if (res.ok) {
      // Re-read the buffer and remove exactly the events we just sent.
      // Any events appended by content.js between our read and now are preserved.
      const fresh = await localGet([STORAGE.TELEMETRY_BUFFER]);
      const current = fresh[STORAGE.TELEMETRY_BUFFER] || [];
      await localSet({ [STORAGE.TELEMETRY_BUFFER]: current.slice(batch.length) });
    }
    // On failure keep the buffer intact — will retry next flush
  } catch (_) {
    // Non-fatal: telemetry must never prevent a save
  }
}

// ─── Service worker startup ───────────────────────────────────────────────────
// MV3 service workers restart frequently; refresh config on each startup so
// the extension never runs stale selectors longer than one poll interval.
refreshScraperConfig();

// ─── Validation constants ─────────────────────────────────────────────────────

const PUC_ORIGIN = 'https://puc.parivahan.gov.in';
const MOBILE_RE  = /^[6-9]\d{9}$/;
const VEHICLE_RE = /^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4}$/;

function getSheetsOAuthClientId() {
  const manifestClientId = chrome.runtime.getManifest()?.oauth2?.client_id;
  return manifestClientId || GOOGLE_SHEETS_CLIENT_ID;
}

const IS_FIREFOX_BUILD = Boolean(chrome.runtime.getManifest()?.browser_specific_settings?.gecko);

const GREENLEAF_WEB_URL_RE = /^https:\/\/greenleaf-frontend\.vercel\.app\//;
const GREENLEAF_LOCAL_URL_RE = /^http:\/\/localhost:3000\//;

function isGreenLeafWebPageUrl(url) {
  return typeof url === 'string' &&
    (GREENLEAF_WEB_URL_RE.test(url) || GREENLEAF_LOCAL_URL_RE.test(url));
}

/**
 * Injected into the GreenLeaf web app (main world) on Firefox so the site can call
 * chrome.runtime.sendMessage(extensionId, { type: 'EXTENSION_TOKEN', token }, cb)
 * the same way as on Chromium (externally_connectable).
 */
function greenleafFirefoxMainWorldShim(extensionId) {
  const BRIDGE = 'GREENLEAF_EXT_BRIDGE_v1';
  const MARK = '__greenleafFfExtShim';
  try {
    if (globalThis[MARK]) return;
    globalThis[MARK] = true;
  } catch (_) {
    /* no-op */
  }
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function')
    return;

  let mid = 0;
  const pending = Object.create(null);

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || !ev.data[BRIDGE] || ev.data.type !== 'sendMessageResponse')
      return;
    const cb = pending[ev.data.id];
    delete pending[ev.data.id];
    if (typeof cb === 'function') cb(ev.data.response);
  });

  function parseArgs(a, b, c, d) {
    if (typeof a === 'object' && a !== null && !Array.isArray(a)) {
      if (typeof b === 'function') return { message: a, cb: b };
    }
    if (typeof a === 'string' && typeof b === 'object' && b !== null) {
      if (typeof c === 'function') return { message: b, cb: c };
      if (typeof d === 'function') return { message: b, cb: d };
    }
    return null;
  }

  globalThis.chrome = globalThis.chrome || {};
  globalThis.chrome.runtime = globalThis.chrome.runtime || {};
  globalThis.chrome.runtime.id = extensionId;
  globalThis.chrome.runtime.sendMessage = function (a, b, c, d) {
    const parsed = parseArgs(a, b, c, d);
    if (!parsed || !parsed.message) return;
    const id = ++mid;
    if (parsed.cb) pending[id] = parsed.cb;
    window.postMessage({ [BRIDGE]: true, type: 'sendMessage', id, message: parsed.message }, '*');
  };
}

async function validateAndPersistExtensionToken(token, invalidTokenMessage) {
  const res = await fetch(`${DEFAULT_BACKEND_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  let email = null;
  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    email = data.email || data.data?.email || null;
  } else if (res.status === 401) {
    throw new Error(invalidTokenMessage);
  } else if (res.status === 404) {
    email = null;
  } else {
    throw new Error(`Backend error: HTTP ${res.status}`);
  }

  await syncSet({
    [STORAGE.GREENLEAF_CONNECTED]: true,
    [STORAGE.GREENLEAF_EMAIL]:     email,
    [STORAGE.AUTH_TOKEN]:          token,
  });
}

// ─── Trusted sender check ─────────────────────────────────────────────────────

/**
 * Accept only messages from:
 *   - Extension pages (popup, options) — sender.tab is undefined
 *   - The PUC portal content script
 *   - The GreenLeaf web app content script (Firefox bridge)
 */
function isTrustedSender(sender) {
  if (!sender.tab) return true; // extension-internal (popup / options / background)
  if (sender.id === chrome.runtime.id) return true; // extension pages opened as tabs (e.g. pending.html)
  if (isGreenLeafWebPageUrl(sender.url)) return true;
  return sender.origin === PUC_ORIGIN ||
         (typeof sender.url === 'string' && sender.url.startsWith(PUC_ORIGIN));
}

// ─── Payload validation ───────────────────────────────────────────────────────

/**
 * Whitelist-validate and sanitise an incoming scraped payload.
 * Returns a clean object or throws.
 */
function validateScrapedPayload(p) {
  if (!p || typeof p !== 'object') throw new Error('Invalid payload');
  const vehicleNo = String(p.vehicleNo || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!vehicleNo || !VEHICLE_RE.test(vehicleNo)) throw new Error('Invalid vehicle number format');
  return {
    vehicleNo,
    validDate:     typeof p.validDate  === 'string' ? p.validDate.slice(0, 20)  : null,
    uptoDate:      typeof p.uptoDate   === 'string' ? p.uptoDate.slice(0, 20)   : null,
    rate:          typeof p.rate       === 'string' ? p.rate.slice(0, 20)       : '0',
    missingFields: Array.isArray(p.missingFields)
                     ? p.missingFields.filter(f => typeof f === 'string').slice(0, 5)
                     : [],
  };
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function addToPending(scrapedData) {
  const result = await localGet([STORAGE.PENDING_RECORDS]);
  const pendingRecords = result[STORAGE.PENDING_RECORDS] || [];
  const idx = pendingRecords.findIndex(r => r.vehicleNo === scrapedData.vehicleNo);
  const record = Object.assign({}, scrapedData, { timestamp: Date.now() });
  if (idx >= 0) pendingRecords[idx] = record;
  else pendingRecords.push(record);
  await localSet({ [STORAGE.PENDING_RECORDS]: pendingRecords });
}

async function removeFromPending(vehicleNo) {
  const result = await localGet([STORAGE.PENDING_RECORDS]);
  const updated = (result[STORAGE.PENDING_RECORDS] || []).filter(r => r.vehicleNo !== vehicleNo);
  await localSet({ [STORAGE.PENDING_RECORDS]: updated });
}

function notify(title, message) {
  const opts = { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 2 };

  function clearLater(id) {
    if (!id || !chrome.notifications || typeof chrome.notifications.clear !== 'function') return;
    setTimeout(() => {
      try { chrome.notifications.clear(id); } catch (_) { /* no-op */ }
    }, 5000);
  }

  function fallbackWebNotification() {
    // Fallback for browsers/environments where extension notifications API behaves differently.
    if (typeof self !== 'undefined' && self.registration && typeof self.registration.showNotification === 'function') {
      self.registration.showNotification(title, { body: message, icon: 'icons/icon128.png' }).catch(() => {});
      return;
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification(title, { body: message, icon: 'icons/icon128.png' }); } catch (_) { /* no-op */ }
    }
  }

  try {
    if (!chrome.notifications || typeof chrome.notifications.create !== 'function') {
      fallbackWebNotification();
      return;
    }

    // Chromium callback style
    const maybeId = chrome.notifications.create('', opts, (id) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        fallbackWebNotification();
        return;
      }
      clearLater(id);
    });

    // Firefox/webextension promise style
    if (maybeId && typeof maybeId.then === 'function') {
      maybeId.then(clearLater).catch(() => fallbackWebNotification());
    } else if (typeof maybeId === 'string' && maybeId) {
      clearLater(maybeId);
    }
  } catch (_) {
    fallbackWebNotification();
  }
}

// ─── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  // Reject messages from untrusted origins
  if (!isTrustedSender(sender)) {
    sendResponse({ success: false, error: 'Untrusted sender' });
    return false;
  }

  if (!message || typeof message.type !== 'string') {
    sendResponse({ success: false, error: 'Malformed message' });
    return false;
  }

  const { type, payload } = message;

  // ── SCRAPED_DATA ──────────────────────────────────────────────────────────
  if (type === MSG.SCRAPED_DATA) {
    (async function() {
      try {
        const clean = validateScrapedPayload(payload);
        await localSet({ [STORAGE.LATEST_SCRAPED]: clean });
        await addToPending(clean);
        notify('Certificate scanned', clean.vehicleNo + ' is ready to save.');
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── SAVE_DATA ─────────────────────────────────────────────────────────────
  if (type === MSG.SAVE_DATA) {
    (async function() {
      try {
        if (!payload || typeof payload !== 'object') throw new Error('Invalid payload');
        // Mobile is optional — validate format when present
        if (payload.mobile) {
          const mob = String(payload.mobile).replace(/\D/g, '');
          if (!MOBILE_RE.test(mob)) throw new Error('Invalid mobile — must be 10 digits starting with 6–9');
        }
        const formatted = formatRecordForBackend(payload);
        await saveRecord(formatted);
        await localSet({ [STORAGE.LATEST_SAVED]: formatted });
        const syncResult = await localGet([STORAGE.TOTAL_SYNCED]);
        await localSet({ [STORAGE.TOTAL_SYNCED]: (syncResult[STORAGE.TOTAL_SYNCED] || 0) + 1 });
        await removeFromPending(formatted.vehicleNo);
        // Hide this certificate from the extension so user cannot save it again (avoids duplicate entries)
        await localSet({ [STORAGE.LATEST_SCRAPED]: null });
        notify('Saved', formatted.vehicleNo + ' saved successfully.');
        flushTelemetry(); // fire-and-forget: never await telemetry on the save path
        sendResponse({ success: true });
      } catch (err) {
        notify('Save failed', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── SAVE_PENDING ──────────────────────────────────────────────────────────
  if (type === MSG.SAVE_PENDING) {
    (async function() {
      try {
        const clean = validateScrapedPayload(payload);
        await addToPending(clean);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── COMPLETE_PENDING ──────────────────────────────────────────────────────
  if (type === MSG.COMPLETE_PENDING) {
    (async function() {
      try {
        if (!payload || typeof payload !== 'object') throw new Error('Invalid payload');

        // Mobile is required to complete a pending record
        const mobile = String(payload.mobile || '').replace(/\D/g, '');
        if (!MOBILE_RE.test(mobile)) {
          throw new Error('Invalid mobile — must be 10 digits starting with 6–9');
        }

        // Vehicle number must be valid
        const vehicleNo = String(payload.vehicleNo || '').toUpperCase().replace(/\s+/g, ' ').trim();
        if (!vehicleNo || !VEHICLE_RE.test(vehicleNo)) {
          throw new Error('Invalid vehicle number');
        }

        const result = await localGet([STORAGE.PENDING_RECORDS]);
        const pendingRecords = result[STORAGE.PENDING_RECORDS] || [];
        const pendingRecord  = pendingRecords.find(r => r.vehicleNo === vehicleNo);
        if (!pendingRecord) {
          sendResponse({ success: false, error: 'Pending record not found' });
          return;
        }

        const complete  = Object.assign({}, pendingRecord, { mobile });
        const formatted = formatRecordForBackend(complete);
        await saveRecord(formatted);
        await localSet({ [STORAGE.LATEST_SAVED]: formatted });
        await removeFromPending(vehicleNo);
        // If the current "latest scraped" is this vehicle, clear it so it is hidden (avoids duplicate saves)
        const latest = await localGet([STORAGE.LATEST_SCRAPED]);
        const scraped = latest[STORAGE.LATEST_SCRAPED];
        if (scraped && scraped.vehicleNo === vehicleNo) {
          await localSet({ [STORAGE.LATEST_SCRAPED]: null });
        }
        notify('Saved', vehicleNo + ' saved successfully.');
        flushTelemetry(); // fire-and-forget: never await telemetry on the save path
        sendResponse({ success: true });
      } catch (err) {
        notify('Save failed', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── Read-only queries ─────────────────────────────────────────────────────
  if (type === MSG.GET_SCRAPED) {
    localGet([STORAGE.LATEST_SCRAPED]).then(function(r) {
      sendResponse({ data: r[STORAGE.LATEST_SCRAPED] || null });
    });
    return true;
  }

  if (type === MSG.GET_LATEST_SAVED) {
    localGet([STORAGE.LATEST_SAVED]).then(function(r) {
      sendResponse({ data: r[STORAGE.LATEST_SAVED] || null });
    });
    return true;
  }

  if (type === MSG.GET_PENDING) {
    localGet([STORAGE.PENDING_RECORDS]).then(function(r) {
      sendResponse({ data: r[STORAGE.PENDING_RECORDS] || [] });
    });
    return true;
  }

  // ── DISCARD_PENDING ───────────────────────────────────────────────────────
  if (type === MSG.DISCARD_PENDING) {
    (async function() {
      try {
        const vehicleNo = payload && payload.vehicleNo;
        if (!vehicleNo) throw new Error('vehicleNo required');
        await removeFromPending(vehicleNo);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── GREENLEAF_PREPARE_WEB_SHIM (Firefox only) ───────────────────────────────
  if (type === MSG.GREENLEAF_PREPARE_WEB_SHIM) {
    if (!IS_FIREFOX_BUILD) {
      sendResponse({ success: true });
      return false;
    }
    (async function() {
      try {
        const tabId = sender.tab?.id;
        const pageUrl = sender.url || sender.tab?.url;
        if (tabId == null || !isGreenLeafWebPageUrl(pageUrl)) {
          sendResponse({ success: false, error: 'Invalid tab' });
          return;
        }
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: greenleafFirefoxMainWorldShim,
          args: [chrome.runtime.id],
        });
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── RELAY_WEB_EXTENSION_TOKEN (Firefox web app → background) ───────────────
  if (type === MSG.RELAY_WEB_EXTENSION_TOKEN) {
    (async function() {
      try {
        const pageUrl = sender.url || sender.tab?.url;
        if (!isGreenLeafWebPageUrl(pageUrl)) {
          sendResponse({ success: false, error: 'Untrusted page' });
          return;
        }
        const inner = payload;
        if (!inner || inner.type !== 'EXTENSION_TOKEN') {
          sendResponse({ success: false, error: 'Invalid message' });
          return;
        }
        const token = inner.token;
        if (!token || typeof token !== 'string') {
          sendResponse({ success: false, error: 'No token provided' });
          return;
        }
        await validateAndPersistExtensionToken(
          token,
          'Invalid or expired token. Please try again.'
        );
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── CONNECT_GREENLEAF ─────────────────────────────────────────────────────
  if (type === MSG.CONNECT_GREENLEAF) {
    (async function() {
      try {
        const { token } = payload || {};
        if (!token) throw new Error('Extension token is required');

        await validateAndPersistExtensionToken(
          token,
          'Invalid token — generate a new one from your GreenLeaf dashboard.'
        );

        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── DISCONNECT_GREENLEAF ──────────────────────────────────────────────────
  if (type === MSG.DISCONNECT_GREENLEAF) {
    (async function() {
      try {
        await syncSet({
          [STORAGE.GREENLEAF_CONNECTED]: false,
          [STORAGE.GREENLEAF_EMAIL]:     null,
          [STORAGE.AUTH_TOKEN]:          null,
        });
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── GET_GREENLEAF_STATUS ──────────────────────────────────────────────────
  if (type === MSG.GET_GREENLEAF_STATUS) {
    syncGet([STORAGE.GREENLEAF_CONNECTED, STORAGE.GREENLEAF_EMAIL, STORAGE.BACKEND_URL])
      .then((sync) => {
        sendResponse({
          connected: !!sync[STORAGE.GREENLEAF_CONNECTED],
          email:     sync[STORAGE.GREENLEAF_EMAIL] || null,
          backendUrl: sync[STORAGE.BACKEND_URL]    || null,
        });
      })
      .catch(() => sendResponse({ connected: false, email: null, backendUrl: null }));
    return true;
  }

  // ── CONNECT_SHEETS ────────────────────────────────────────────────────────
  // Use the extension's own Google OAuth client (GOOGLE_SHEETS_CLIENT_ID) so the
  // redirect_uri (chrome.identity.getRedirectURL()) is valid. The backend's client
  // has web redirect URIs only, so using it causes Error 400: redirect_uri_mismatch.
  if (type === MSG.CONNECT_SHEETS) {
    (async function() {
      try {
        const clientId = getSheetsOAuthClientId();
        if (!clientId || String(clientId).startsWith('YOUR_')) {
          throw new Error('Google OAuth client ID is not configured for this browser build.');
        }
        const redirectUri = chrome.identity.getRedirectURL();
        const scope = [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/drive.metadata.readonly',
        ].join(' ');

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'token');
        authUrl.searchParams.set('scope', scope);
        authUrl.searchParams.set('prompt', 'select_account');

        const responseUrl = await new Promise((resolve, reject) => {
          chrome.identity.launchWebAuthFlow(
            { url: authUrl.toString(), interactive: true },
            (url) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else if (!url) reject(new Error('Auth cancelled'));
              else resolve(url);
            }
          );
        });

        const fragment = new URL(responseUrl).hash.slice(1);
        const token = new URLSearchParams(fragment).get('access_token');
        if (!token) throw new Error('No access token returned. Please try again.');

        const email = await getGoogleUserEmail(token);

        let spreadsheetId, title, isNew;
        const userProvidedId = payload && payload.spreadsheetId;
        if (userProvidedId) {
          const info = await verifySheetsSpreadsheet(token, userProvidedId);
          spreadsheetId = userProvidedId;
          title = info.title;
          isNew = false;
        } else {
          const existing = await findExistingGreenLeafSheet(token);
          if (existing) {
            spreadsheetId = existing.spreadsheetId;
            title = existing.title;
            isNew = false;
          } else {
            const created = await createSheetsSpreadsheet(token);
            spreadsheetId = created.spreadsheetId;
            title = created.title;
            isNew = true;
          }
        }
        await syncSet({
          [STORAGE.SHEETS_CONNECTED]:        true,
          [STORAGE.SHEETS_EMAIL]:            email,
          [STORAGE.SHEETS_SPREADSHEET_ID]:   spreadsheetId,
          [STORAGE.SHEETS_SPREADSHEET_NAME]: title,
          [STORAGE.SHEETS_ACCESS_TOKEN]:     token,
          [STORAGE.SHEETS_IS_NEW]:           isNew,
        });

        sendResponse({ success: true, email, sheetName: title, isNew });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── DISCONNECT_SHEETS ─────────────────────────────────────────────────────
  if (type === MSG.DISCONNECT_SHEETS) {
    (async function() {
      try {
        // launchWebAuthFlow tokens aren't cached by Chrome, so just clear storage.
        await syncSet({
          [STORAGE.SHEETS_CONNECTED]:        false,
          [STORAGE.SHEETS_EMAIL]:            null,
          [STORAGE.SHEETS_SPREADSHEET_ID]:   null,
          [STORAGE.SHEETS_SPREADSHEET_NAME]: null,
          [STORAGE.SHEETS_ACCESS_TOKEN]:     null,
          [STORAGE.SHEETS_REFRESH_TOKEN]:   null,
          [STORAGE.SHEETS_IS_NEW]:           null,
        });

        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── GET_SHEETS_STATUS ─────────────────────────────────────────────────────
  if (type === MSG.GET_SHEETS_STATUS) {
    syncGet([STORAGE.SHEETS_CONNECTED, STORAGE.SHEETS_EMAIL, STORAGE.SHEETS_SPREADSHEET_NAME, STORAGE.SHEETS_IS_NEW, STORAGE.SHEETS_SPREADSHEET_ID])
      .then((sync) => {
        sendResponse({
          connected:     !!sync[STORAGE.SHEETS_CONNECTED],
          email:         sync[STORAGE.SHEETS_EMAIL]            || null,
          sheetName:     sync[STORAGE.SHEETS_SPREADSHEET_NAME] || null,
          isNew:         sync[STORAGE.SHEETS_IS_NEW]           ?? null,
          spreadsheetId: sync[STORAGE.SHEETS_SPREADSHEET_ID]  || null,
        });
      })
      .catch(() => sendResponse({ connected: false, email: null, sheetName: null, isNew: null, spreadsheetId: null }));
    return true;
  }

  // Unknown message type — reject
  sendResponse({ success: false, error: 'Unknown message type' });
  return false;
});

// ─── External message listener (from web app tab) ─────────────────────────────

/**
 * Receives { type: 'EXTENSION_TOKEN', token: '...' } from the GreenLeaf
 * web app after the user completes login. The token is validated against
 * the backend and then stored in sync storage.
 */
chrome.runtime.onMessageExternal.addListener(function(message, sender, sendResponse) {
  if (!message || message.type !== 'EXTENSION_TOKEN') {
    sendResponse({ success: false, error: 'Unknown message' });
    return false;
  }

  const { token } = message;
  if (!token || typeof token !== 'string') {
    sendResponse({ success: false, error: 'No token provided' });
    return false;
  }

  (async function() {
    try {
      await validateAndPersistExtensionToken(
        token,
        'Invalid or expired token. Please try again.'
      );
      sendResponse({ success: true });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // keep message channel open for async response
});
