import { MSG, APP_URL } from './utils/constants.js';
import { formatForDisplay, isExpiringSoon } from './utils/date.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function sendMsg(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function escapeHtml(text) {
  if (text == null) return '';
  const d = document.createElement('div');
  d.textContent = String(text);
  return d.innerHTML;
}

function validateMobile(value) {
  if (!value) return null;
  if (!/^[6-9]\d{9}$/.test(value)) return 'Must be 10 digits starting with 6–9';
  return null;
}

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className   = `connect-status ${type}`;
}

// ── Toast ───────────────────────────────────────────────────────────────────────

let _toastTimer = null;

function showToast(msg, type = '', ms = 2500) {
  const el = document.getElementById('popupToast');
  if (!el) return;
  el.textContent = msg;
  el.className = `popup-toast${type ? ' ' + type : ''} visible`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.classList.remove('visible'); }, ms);
}

// ── View routing ───────────────────────────────────────────────────────────────

function showView(name) {
  document.getElementById('viewConnect').style.display        = name === 'connect'        ? 'block' : 'none';
  document.getElementById('viewGreenLeafLogin').style.display = name === 'greenleafLogin' ? 'block' : 'none';
  document.getElementById('viewMain').style.display           = name === 'main'           ? 'block' : 'none';
}

// ── Header icon state ─────────────────────────────────────────────────────────

let _glConnected     = false;
let _sheetsConnected = false;

function updateHeaderIcons(glConnected, glEmail, sheetsConnected, sheetName) {
  _glConnected     = !!glConnected;
  _sheetsConnected = !!sheetsConnected;

  const glBtn    = document.getElementById('hdrGlBtn');
  const glDot    = document.getElementById('hdrGlDot');
  const shBtn    = document.getElementById('hdrSheetsBtn');
  const shDot    = document.getElementById('hdrSheetsDot');

  if (_glConnected) {
    glBtn.classList.add('gl-connected');
    glDot.classList.add('visible');
    glBtn.title = `GreenLeaf · ${glEmail || 'Connected'} · Click to disconnect`;
  } else {
    glBtn.classList.remove('gl-connected');
    glDot.classList.remove('visible');
    glBtn.title = 'Login to GreenLeaf';
  }

  if (_sheetsConnected) {
    shBtn.classList.add('sh-connected');
    shDot.classList.add('visible');
    shBtn.title = `Google Sheets · ${sheetName || 'Connected'} · Click to disconnect`;
  } else {
    shBtn.classList.remove('sh-connected');
    shDot.classList.remove('visible');
    shBtn.title = 'Connect Google Sheets';
  }
}

// ── Connection tray ────────────────────────────────────────────────────────────

function updateTrayHandle(glConnected, sheetsConnected) {
  const glPip  = document.getElementById('trayGlPip');
  const shPip  = document.getElementById('trayShPip');
  const label  = document.getElementById('trayLabel');

  if (glPip) glPip.style.display = glConnected    ? '' : 'none';
  if (shPip) shPip.style.display = sheetsConnected ? '' : 'none';

  if (label) {
    const parts = [];
    if (glConnected)    parts.push('GreenLeaf');
    if (sheetsConnected) parts.push('Google Sheets');
    label.textContent = parts.join(' · ');
  }
}

function initTrayToggle() {
  const tray   = document.getElementById('connectionTray');
  const toggle = document.getElementById('trayToggle');
  if (!tray || !toggle) return;

  // Restore saved collapsed state
  chrome.storage.local.get(['trayCollapsed'], (r) => {
    if (r.trayCollapsed) tray.classList.add('tray-collapsed');
  });

  toggle.addEventListener('click', () => {
    const collapsed = tray.classList.toggle('tray-collapsed');
    chrome.storage.local.set({ trayCollapsed: collapsed });
  });
}

async function initView() {
  try {
    const [sheetsRes, glRes] = await Promise.all([
      sendMsg(MSG.GET_SHEETS_STATUS),
      sendMsg(MSG.GET_GREENLEAF_STATUS),
    ]);

    const sheetsOk    = sheetsRes && sheetsRes.connected;
    const greenleafOk = glRes    && glRes.connected;

    // Always keep header icons in sync
    updateHeaderIcons(
      greenleafOk, glRes && glRes.email,
      sheetsOk,    sheetsRes && sheetsRes.sheetName
    );

    if (!sheetsOk && !greenleafOk) {
      showView('connect');
      return;
    }

    // Update banners
    const sheetsBanner    = document.getElementById('sheetsBanner');
    const greenleafBanner = document.getElementById('greenleafBanner');

    sheetsBanner.style.display    = sheetsOk    ? '' : 'none';
    greenleafBanner.style.display = greenleafOk ? '' : 'none';

    if (sheetsOk) {
      document.getElementById('connEmail').textContent = sheetsRes.email || '';
      const sheetPrefix = sheetsRes.isNew === false ? 'Existing · ' : 'Created · ';
      document.getElementById('connSheet').textContent = sheetPrefix + (sheetsRes.sheetName || '');
      const sheetLink = document.getElementById('sheetLink');
      if (sheetLink && sheetsRes.spreadsheetId) {
        sheetLink.href = `https://docs.google.com/spreadsheets/d/${sheetsRes.spreadsheetId}`;
      }
    }
    if (greenleafOk) {
      document.getElementById('glEmail').textContent = glRes.email || glRes.backendUrl || 'GreenLeaf';
      const glAppLink = document.getElementById('glAppLink');
      if (glAppLink) glAppLink.href = APP_URL;
    }

    updateTrayHandle(greenleafOk, sheetsOk);
    showView('main');
    loadScrapedData();
    loadPendingRecords();
    loadLatestSaved();
  } catch (_) {
    showView('connect');
  }
}

// ── GreenLeaf connect / disconnect ────────────────────────────────────────────

let _pollInterval = null;

function startConnectionPoll() {
  if (_pollInterval) return;
  _pollInterval = setInterval(async () => {
    try {
      const res = await sendMsg(MSG.GET_GREENLEAF_STATUS);
      if (res && res.connected) {
        stopConnectionPoll();
        await initView();
      }
    } catch (_) { /* popup may be closing */ }
  }, 2000);
}

function stopConnectionPoll() {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}

function showGreenLeafLogin() {
  showView('greenleafLogin');
  // Open the web-app auth page in a new tab — it will send the token back
  chrome.tabs.create({
    url: `${APP_URL}/extension-connect?ext_id=${chrome.runtime.id}`,
  });
  startConnectionPoll();
}

async function handleDisconnectGreenLeaf() {
  const btn = document.getElementById('glDisconnectBtn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  showToast('Disconnecting GreenLeaf…');
  try {
    await sendMsg(MSG.DISCONNECT_GREENLEAF);
    showToast('GreenLeaf disconnected', '', 2000);
    await initView();
  } catch (_) {
    if (btn) { btn.disabled = false; btn.textContent = 'Disconnect'; }
  }
}

// ── Google Sheets connect / disconnect ────────────────────────────────────────

function extractSpreadsheetId(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;
  // Extract from full Google Sheets URL
  const m = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // Treat as a raw ID (alphanumeric + hyphens/underscores, at least 20 chars)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

async function handleConnectSheets() {
  const btn    = document.getElementById('connectSheetsBtn');   // may be in a hidden view
  const status = document.getElementById('connectStatus');
  const hdrBtn = document.getElementById('hdrSheetsBtn');
  const urlInput = document.getElementById('sheetsUrlInput');

  // Extract optional existing spreadsheet ID
  const rawInput      = urlInput ? urlInput.value : '';
  const spreadsheetId = extractSpreadsheetId(rawInput);

  // If user typed something but it doesn't look valid, reject early
  if (rawInput.trim() && !spreadsheetId) {
    if (status) setStatus(status, 'Invalid spreadsheet URL or ID. Paste the full Sheets URL.', 'err');
    return;
  }

  if (btn) btn.disabled = true;
  if (hdrBtn) hdrBtn.disabled = true;
  if (status) setStatus(status, 'Connecting to Google…', 'loading');
  showToast('Connecting to Google Sheets…');

  try {
    const res = await sendMsg(MSG.CONNECT_SHEETS, spreadsheetId ? { spreadsheetId } : undefined);
    if (!res || !res.success) throw new Error(res && res.error || 'Connection failed');
    if (urlInput) urlInput.value = '';
    const label = res.isNew === false ? 'Linked to existing sheet' : 'Google Sheets connected';
    showToast(label, 'ok', 3000);
    await initView();
  } catch (err) {
    if (status) setStatus(status, err.message, 'err');
    showToast(err.message, 'err', 4000);
    if (btn) btn.disabled = false;
  } finally {
    // Always re-enable the header button so it stays clickable after connect/failure
    if (hdrBtn) hdrBtn.disabled = false;
  }
}

async function handleDisconnectSheets() {
  const btn = document.getElementById('disconnectBtn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  showToast('Disconnecting Google Sheets…');
  try {
    await sendMsg(MSG.DISCONNECT_SHEETS);
    showToast('Google Sheets disconnected', '', 2000);
    await initView();
  } catch (_) {
    if (btn) { btn.disabled = false; btn.textContent = 'Disconnect'; }
  }
}

// ── Current Certificate ────────────────────────────────────────────────────────

async function loadScrapedData() {
  const body = document.getElementById('currentBody');
  try {
    const res = await sendMsg(MSG.GET_SCRAPED);
    const d   = res && res.data;
    if (!d || !d.vehicleNo) {
      body.innerHTML = `
        <div class="no-data-state">
          <div class="no-data-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </div>
          <p class="no-data-title">No certificate scanned yet</p>
          <ol class="no-data-steps">
            <li>Go to <strong>puc.parivahan.gov.in</strong></li>
            <li>Search for a vehicle and open its certificate</li>
            <li>Data will appear here automatically</li>
          </ol>
          <a class="btn-portal" href="https://puc.parivahan.gov.in" target="_blank">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Open PUC Portal
          </a>
        </div>
      `;
      return;
    }

    const expiring     = isExpiringSoon(d.uptoDate);
    const uptoDisplay  = formatForDisplay(d.uptoDate);
    const validDisplay = formatForDisplay(d.validDate);
    const rate = d.rate ? `₹${escapeHtml(String(d.rate))}` : 'N/A';

    body.innerHTML = `
      <div class="cert-vehicle">${escapeHtml(d.vehicleNo)}</div>
      <div class="cert-meta">
        <div class="meta-cell">
          <div class="meta-label">Issued</div>
          <div class="meta-value">${escapeHtml(validDisplay)}</div>
        </div>
        <div class="meta-cell${expiring ? ' expiring' : ''}">
          <div class="meta-label">Expires</div>
          <div class="meta-value">${escapeHtml(uptoDisplay)}</div>
        </div>
        <div class="meta-cell">
          <div class="meta-label">Fee</div>
          <div class="meta-value">${rate}</div>
        </div>
      </div>
      <div class="mobile-row">
        <div class="mobile-wrap">
          <input type="tel" id="mobileInput" class="field-input"
                 placeholder="Mobile (optional)" maxlength="10">
          <div id="mobileError" class="field-error"></div>
        </div>
        <button id="saveBtn" class="btn-save">Save</button>
        <button id="savePendingBtn" class="btn-pending" title="Save without mobile">&#128204;</button>
      </div>
      <div id="saveFeedback" class="save-feedback"></div>
    `;

    document.getElementById('mobileInput').addEventListener('input', (e) => {
      const err = validateMobile(e.target.value.trim());
      document.getElementById('mobileError').textContent = err || '';
      e.target.classList.toggle('has-error', !!err);
    });
    document.getElementById('mobileInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('saveBtn').click();
    });
    document.getElementById('saveBtn').addEventListener('click', () => saveData(d));
    document.getElementById('savePendingBtn').addEventListener('click', () => saveAsPending(d));

  } catch (err) {
    body.innerHTML = `<div class="empty">Error loading data: ${escapeHtml(err.message)}</div>`;
  }
}

async function saveData(scrapedData) {
  const mobileInput = document.getElementById('mobileInput');
  const mobileError = document.getElementById('mobileError');
  const feedback    = document.getElementById('saveFeedback');
  const saveBtn     = document.getElementById('saveBtn');

  const mobile    = mobileInput.value.trim();
  const mobileErr = validateMobile(mobile);
  if (mobileErr) {
    mobileInput.classList.add('has-error');
    mobileError.textContent = mobileErr;
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '…';
  feedback.textContent = '';
  feedback.className = 'save-feedback';

  try {
    const res = await sendMsg(MSG.SAVE_DATA, { ...scrapedData, mobile });
    if (res && res.success) {
      feedback.textContent = 'Saved';
      feedback.className = 'save-feedback ok';
      mobileInput.value = '';
      setTimeout(() => { loadLatestSaved(); loadPendingRecords(); }, 400);
    } else {
      throw new Error(res && res.error || 'Save failed');
    }
  } catch (err) {
    feedback.textContent = err.message;
    feedback.className = 'save-feedback err';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
}

async function saveAsPending(scrapedData) {
  const savePendingBtn = document.getElementById('savePendingBtn');
  const feedback       = document.getElementById('saveFeedback');

  savePendingBtn.disabled = true;
  feedback.textContent = '';
  feedback.className = 'save-feedback';

  try {
    const res = await sendMsg(MSG.SAVE_PENDING, scrapedData);
    if (res && res.success) {
      feedback.textContent = 'Saved as pending';
      feedback.className = 'save-feedback ok';
      setTimeout(loadPendingRecords, 300);
    } else {
      throw new Error(res && res.error || 'Failed');
    }
  } catch (err) {
    feedback.textContent = err.message;
    feedback.className = 'save-feedback err';
  } finally {
    savePendingBtn.disabled = false;
  }
}

// ── Pending Records ────────────────────────────────────────────────────────────

const PENDING_INLINE_LIMIT = 3;

async function loadPendingRecords() {
  const listEl  = document.getElementById('pendingList');
  const badgeEl = document.getElementById('pendingBadge');

  try {
    const res     = await sendMsg(MSG.GET_PENDING);
    const records = (res && res.data) || [];

    badgeEl.textContent = records.length;

    const card = document.getElementById('cardPending');
    if (records.length === 0) {
      if (card) card.style.display = 'none';
      listEl.innerHTML = '<div class="empty">No pending records.</div>';
      return;
    }
    if (card) card.style.display = '';

    records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const overflow  = records.length - PENDING_INLINE_LIMIT;
    const toShow    = overflow > 0 ? records.slice(0, PENDING_INLINE_LIMIT) : records;

    listEl.innerHTML = toShow.map((r, i) => {
      const uptoDisplay = formatForDisplay(r.uptoDate);
      const expiring    = isExpiringSoon(r.uptoDate);
      return `
        <div class="pending-item">
          <div class="pending-item-vehicle">${escapeHtml(r.vehicleNo)}</div>
          <div class="pending-item-dates${expiring ? ' expiring' : ''}">Expires: ${escapeHtml(uptoDisplay)}</div>
          <div class="pending-row">
            <div class="mobile-wrap">
              <input type="tel" class="field-input pending-input" data-idx="${i}"
                     placeholder="Mobile number" maxlength="10">
            </div>
            <button class="btn-complete" data-vehicle="${escapeHtml(r.vehicleNo)}" data-idx="${i}">Save</button>
          </div>
          <div class="pending-item-feedback" id="pf${i}"></div>
        </div>
      `;
    }).join('');

    if (overflow > 0) {
      listEl.insertAdjacentHTML('beforeend', `
        <button class="btn-view-all" id="viewAllPendingBtn">
          +${overflow} more — Manage all ${records.length} pending →
        </button>
      `);
      document.getElementById('viewAllPendingBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('pending.html') });
      });
    }

    listEl.querySelectorAll('.btn-complete').forEach(btn => {
      btn.addEventListener('click', () => completePending(btn));
    });
    listEl.querySelectorAll('.pending-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const btn = listEl.querySelector(`.btn-complete[data-idx="${input.dataset.idx}"]`);
          if (btn) btn.click();
        }
      });
    });

  } catch (err) {
    listEl.innerHTML = `<div class="empty">Error: ${escapeHtml(err.message)}</div>`;
  }
}

async function completePending(btn) {
  const vehicleNo = btn.dataset.vehicle;
  const idx       = btn.dataset.idx;
  const input     = document.querySelector(`.pending-input[data-idx="${idx}"]`);
  const feedback  = document.getElementById(`pf${idx}`);

  const mobile = input ? input.value.trim() : '';
  if (!mobile) {
    feedback.textContent = 'Enter a mobile number';
    feedback.className = 'pending-item-feedback err';
    return;
  }
  const mobileErr = validateMobile(mobile);
  if (mobileErr) {
    feedback.textContent = mobileErr;
    feedback.className = 'pending-item-feedback err';
    return;
  }

  btn.disabled = true;
  btn.textContent = '…';
  feedback.textContent = '';
  feedback.className = 'pending-item-feedback';

  try {
    const res = await sendMsg(MSG.COMPLETE_PENDING, { vehicleNo, mobile });
    if (res && res.success) {
      feedback.textContent = 'Saved!';
      feedback.className = 'pending-item-feedback ok';
      setTimeout(() => { loadPendingRecords(); loadLatestSaved(); }, 400);
    } else {
      throw new Error(res && res.error || 'Failed');
    }
  } catch (err) {
    feedback.textContent = err.message;
    feedback.className = 'pending-item-feedback err';
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ── Last Saved ─────────────────────────────────────────────────────────────────

async function loadLatestSaved() {
  const savedBody  = document.getElementById('savedBody');
  const savedCheck = document.getElementById('savedCheck');

  try {
    const res = await sendMsg(MSG.GET_LATEST_SAVED);
    const d   = res && res.data;

    if (!d || !d.vehicleNo) {
      const card = document.getElementById('cardSaved');
      if (card) card.style.display = 'none';
      savedBody.innerHTML = '<div class="empty">Nothing saved yet.</div>';
      if (savedCheck) savedCheck.style.display = 'none';
      return;
    }
    const card = document.getElementById('cardSaved');
    if (card) card.style.display = '';

    const uptoDisplay = formatForDisplay(d.validUpto || d.uptoDate);
    const rate        = d.rate != null ? `₹${escapeHtml(String(d.rate))}` : 'N/A';
    const mobile      = d.mobile || '—';

    savedBody.innerHTML = `
      <div class="saved-row">
        <div>
          <div class="saved-vehicle">${escapeHtml(d.vehicleNo)}</div>
          <div class="saved-meta">${escapeHtml(mobile)} &middot; Expires ${escapeHtml(uptoDisplay)} &middot; ${rate}</div>
        </div>
      </div>
    `;
    if (savedCheck) savedCheck.style.display = '';

  } catch (err) {
    savedBody.innerHTML = `<div class="empty">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  showView('connect');
  initTrayToggle();
  initView();

  // ── Connect / login view buttons ────────────────────────────────────────────
  document.getElementById('loginBtn').addEventListener('click',         showGreenLeafLogin);
  document.getElementById('backBtn').addEventListener('click',          () => { stopConnectionPoll(); showView('connect'); });
  document.getElementById('connectSheetsBtn').addEventListener('click', handleConnectSheets);

  // ── Main view disconnect buttons ────────────────────────────────────────────
  document.getElementById('glDisconnectBtn').addEventListener('click',  handleDisconnectGreenLeaf);
  document.getElementById('disconnectBtn').addEventListener('click',    handleDisconnectSheets);

  // ── Header status icons (always visible) ────────────────────────────────────
  document.getElementById('hdrGlBtn').addEventListener('click', () => {
    if (_glConnected) handleDisconnectGreenLeaf();
    else showGreenLeafLogin();
  });

  document.getElementById('hdrSheetsBtn').addEventListener('click', () => {
    if (_sheetsConnected) handleDisconnectSheets();
    else handleConnectSheets();
  });
});
