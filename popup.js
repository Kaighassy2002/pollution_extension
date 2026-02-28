import { MSG, DEFAULT_BACKEND_URL } from './utils/constants.js';
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

// ── View routing ───────────────────────────────────────────────────────────────

function showView(name) {
  document.getElementById('viewConnect').style.display        = name === 'connect'        ? '' : 'none';
  document.getElementById('viewGreenLeafLogin').style.display = name === 'greenleafLogin' ? '' : 'none';
  document.getElementById('viewMain').style.display           = name === 'main'           ? '' : 'none';
}

async function initView() {
  try {
    const [sheetsRes, glRes] = await Promise.all([
      sendMsg(MSG.GET_SHEETS_STATUS),
      sendMsg(MSG.GET_GREENLEAF_STATUS),
    ]);

    const sheetsOk    = sheetsRes && sheetsRes.connected;
    const greenleafOk = glRes    && glRes.connected;

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
      document.getElementById('connEmail').textContent = sheetsRes.email    || '';
      document.getElementById('connSheet').textContent = sheetsRes.sheetName || '';
    }
    if (greenleafOk) {
      document.getElementById('glEmail').textContent = glRes.email || glRes.backendUrl || 'GreenLeaf';
    }

    showView('main');
    loadScrapedData();
    loadPendingRecords();
    loadLatestSaved();
  } catch (_) {
    showView('connect');
  }
}

// ── GreenLeaf connect / disconnect ────────────────────────────────────────────

function showGreenLeafLogin() {
  // Pre-fill backend URL if empty
  const urlInput = document.getElementById('glBackendUrl');
  if (!urlInput.value) urlInput.value = DEFAULT_BACKEND_URL;
  showView('greenleafLogin');
}

async function handleConnectGreenLeaf() {
  const btn     = document.getElementById('glConnectBtn');
  const status  = document.getElementById('glStatus');
  const urlVal  = document.getElementById('glBackendUrl').value.trim();
  const tokenVal = document.getElementById('glToken').value.trim();

  if (!urlVal || !tokenVal) {
    setStatus(status, 'Both fields are required', 'err');
    return;
  }

  btn.disabled = true;
  setStatus(status, 'Connecting…', 'loading');

  try {
    const res = await sendMsg(MSG.CONNECT_GREENLEAF, { backendUrl: urlVal, token: tokenVal });
    if (!res || !res.success) throw new Error(res && res.error || 'Connection failed');
    await initView(); // will route to main view
  } catch (err) {
    setStatus(status, err.message, 'err');
    btn.disabled = false;
  }
}

async function handleDisconnectGreenLeaf() {
  const btn = document.getElementById('glDisconnectBtn');
  btn.disabled = true;
  try {
    await sendMsg(MSG.DISCONNECT_GREENLEAF);
    await initView();
  } catch (_) {
    btn.disabled = false;
  }
}

// ── Google Sheets connect / disconnect ────────────────────────────────────────

async function handleConnectSheets() {
  const btn    = document.getElementById('connectSheetsBtn');
  const status = document.getElementById('connectStatus');

  btn.disabled = true;
  setStatus(status, 'Connecting to Google…', 'loading');

  try {
    const res = await sendMsg(MSG.CONNECT_SHEETS);
    if (!res || !res.success) throw new Error(res && res.error || 'Connection failed');
    await initView();
  } catch (err) {
    setStatus(status, err.message, 'err');
    btn.disabled = false;
  }
}

async function handleDisconnectSheets() {
  const btn = document.getElementById('disconnectBtn');
  btn.disabled = true;
  try {
    await sendMsg(MSG.DISCONNECT_SHEETS);
    await initView();
  } catch (_) {
    btn.disabled = false;
  }
}

// ── Current Certificate ────────────────────────────────────────────────────────

async function loadScrapedData() {
  const body = document.getElementById('currentBody');
  try {
    const res = await sendMsg(MSG.GET_SCRAPED);
    const d   = res && res.data;
    if (!d || !d.vehicleNo) {
      body.innerHTML = '<div class="empty">Open a PUC certificate page to scan data.</div>';
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

async function loadPendingRecords() {
  const listEl  = document.getElementById('pendingList');
  const badgeEl = document.getElementById('pendingBadge');

  try {
    const res     = await sendMsg(MSG.GET_PENDING);
    const records = (res && res.data) || [];

    badgeEl.textContent = records.length;

    if (records.length === 0) {
      listEl.innerHTML = '<div class="empty">No pending records.</div>';
      return;
    }

    records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    listEl.innerHTML = records.map((r, i) => {
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
      savedBody.innerHTML = '<div class="empty">Nothing saved yet.</div>';
      if (savedCheck) savedCheck.style.display = 'none';
      return;
    }

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
  initView();

  document.getElementById('settingsBtn').addEventListener('click',    () => chrome.runtime.openOptionsPage());
  document.getElementById('loginBtn').addEventListener('click',       showGreenLeafLogin);
  document.getElementById('backBtn').addEventListener('click',        () => showView('connect'));
  document.getElementById('glConnectBtn').addEventListener('click',   handleConnectGreenLeaf);
  document.getElementById('glDisconnectBtn').addEventListener('click', handleDisconnectGreenLeaf);
  document.getElementById('connectSheetsBtn').addEventListener('click', handleConnectSheets);
  document.getElementById('disconnectBtn').addEventListener('click',  handleDisconnectSheets);
});
