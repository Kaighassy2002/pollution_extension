import { MSG, STORAGE }           from './utils/constants.js';
import { formatRecordForBackend }   from './utils/date.js';
import { localGet, localSet }       from './utils/storage.js';
import { saveRecord }               from './utils/api.js';

// ─── Validation constants ─────────────────────────────────────────────────────

const PUC_ORIGIN = 'https://puc.parivahan.gov.in';
const MOBILE_RE  = /^[6-9]\d{9}$/;
const VEHICLE_RE = /^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4}$/;

// ─── Trusted sender check ─────────────────────────────────────────────────────

/**
 * Accept only messages from:
 *   - Extension pages (popup, options) — sender.tab is undefined
 *   - The PUC portal content script
 */
function isTrustedSender(sender) {
  if (!sender.tab) return true; // extension-internal (popup / options / background)
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
  chrome.notifications.create(
    { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 2 },
    function(id) { setTimeout(function() { chrome.notifications.clear(id); }, 5000); }
  );
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
        notify('Saved', formatted.vehicleNo + ' saved successfully.');
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
        notify('Saved', vehicleNo + ' saved successfully.');
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

  // Unknown message type — reject
  sendResponse({ success: false, error: 'Unknown message type' });
  return false;
});
