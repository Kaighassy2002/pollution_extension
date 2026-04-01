import { MSG }                           from './utils/constants.js';
import { formatForDisplay, isExpiringSoon } from './utils/date.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function sendMsg(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
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

// ── Render ─────────────────────────────────────────────────────────────────────

function renderRecord(r, idx) {
  const uptoDisplay  = formatForDisplay(r.uptoDate);
  const validDisplay = formatForDisplay(r.validDate);
  const expiring     = isExpiringSoon(r.uptoDate);
  const rate         = r.rate ? `₹${escapeHtml(String(r.rate))}` : '—';

  const card = document.createElement('div');
  card.className = 'record-card';
  card.dataset.vehicle = r.vehicleNo;

  card.innerHTML = `
    <div class="record-top">
      <div>
        <div class="record-vehicle">${escapeHtml(r.vehicleNo)}</div>
        <div class="record-date">Scanned ${r.timestamp ? new Date(r.timestamp).toLocaleDateString('en-IN') : '—'}</div>
      </div>
      <span class="expiry-badge ${expiring ? 'warning' : 'ok'}">
        ${expiring ? '⚠ Expiring' : 'Valid'} · ${escapeHtml(uptoDisplay)}
      </span>
    </div>
    <div class="record-meta">
      <span><strong>Issued</strong> ${escapeHtml(validDisplay)}</span>
      <span><strong>Fee</strong> ${rate}</span>
    </div>
    <div class="record-input-row">
      <div class="record-input-wrap">
        <input type="tel" class="field-input pending-mobile" data-idx="${idx}"
               placeholder="Enter mobile number" maxlength="10">
        <div class="field-error" id="err${idx}"></div>
      </div>
      <button class="btn-save" data-vehicle="${escapeHtml(r.vehicleNo)}" data-idx="${idx}">Save</button>
      <button class="btn-discard" data-vehicle="${escapeHtml(r.vehicleNo)}" title="Discard this record">&#x2715;</button>
    </div>
    <div class="record-feedback" id="fb${idx}"></div>
  `;

  // Mobile input validation on type
  const input = card.querySelector('.pending-mobile');
  input.addEventListener('input', () => {
    const err = validateMobile(input.value.trim());
    document.getElementById(`err${idx}`).textContent = err || '';
    input.classList.toggle('has-error', !!err);
  });

  // Enter key submits
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') card.querySelector('.btn-save').click();
  });

  // Save button
  card.querySelector('.btn-save').addEventListener('click', () => saveRecord(card, r.vehicleNo, input, idx));

  // Discard button
  card.querySelector('.btn-discard').addEventListener('click', () => discardRecord(card, r.vehicleNo));

  return card;
}

async function saveRecord(card, vehicleNo, input, idx) {
  const mobile    = input.value.trim();
  const mobileErr = validateMobile(mobile);
  const errEl     = document.getElementById(`err${idx}`);
  const feedEl    = document.getElementById(`fb${idx}`);
  const saveBtn   = card.querySelector('.btn-save');

  if (!mobile) {
    errEl.textContent = 'Enter a mobile number to save';
    input.classList.add('has-error');
    return;
  }
  if (mobileErr) {
    errEl.textContent = mobileErr;
    input.classList.add('has-error');
    return;
  }

  card.classList.add('saving');
  saveBtn.disabled    = true;
  saveBtn.textContent = '…';
  feedEl.textContent  = '';
  feedEl.className    = 'record-feedback';

  try {
    const res = await sendMsg(MSG.COMPLETE_PENDING, { vehicleNo, mobile });
    if (res && res.success) {
      feedEl.textContent = 'Saved!';
      feedEl.className   = 'record-feedback ok';
      // Fade the card out and remove it
      setTimeout(() => {
        card.style.transition = 'opacity 0.3s, transform 0.3s';
        card.style.opacity    = '0';
        card.style.transform  = 'translateX(12px)';
        setTimeout(() => {
          card.remove();
          updateCount();
        }, 300);
      }, 600);
    } else {
      throw new Error(res && res.error || 'Save failed');
    }
  } catch (err) {
    feedEl.textContent = err.message;
    feedEl.className   = 'record-feedback err';
    card.classList.remove('saving');
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save';
  }
}

async function discardRecord(card, vehicleNo) {
  const btn = card.querySelector('.btn-discard');
  if (btn) btn.disabled = true;
  try {
    await sendMsg(MSG.DISCARD_PENDING, { vehicleNo });
    card.style.transition = 'opacity 0.3s, transform 0.3s';
    card.style.opacity    = '0';
    card.style.transform  = 'translateX(12px)';
    setTimeout(() => { card.remove(); updateCount(); }, 300);
  } catch (err) {
    if (btn) btn.disabled = false;
  }
}

// ── Count badge ────────────────────────────────────────────────────────────────

function updateCount() {
  const remaining = document.querySelectorAll('.record-card').length;
  document.getElementById('countBadge').textContent = remaining;
  if (remaining === 0) showEmpty();
}

function showEmpty() {
  document.getElementById('content').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
      </div>
      <h2>All caught up!</h2>
      <p>No pending certificates left. You can close this tab.</p>
    </div>
  `;
}

// ── Init ───────────────────────────────────────────────────────────────────────

async function init() {
  const content = document.getElementById('content');
  const badge   = document.getElementById('countBadge');

  try {
    const res     = await sendMsg(MSG.GET_PENDING);
    const records = (res && res.data) || [];

    records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    badge.textContent = records.length;

    if (records.length === 0) {
      showEmpty();
      return;
    }

    const list = document.createElement('div');
    list.className = 'records-list';
    records.forEach((r, i) => list.appendChild(renderRecord(r, i)));

    content.innerHTML = '';
    content.appendChild(list);
  } catch (err) {
    content.innerHTML = `
      <div class="empty-state">
        <p style="color:#dc2626">Failed to load records: ${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

// Reload when tab regains focus (in case popup saved something in the meantime)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') init();
});

document.addEventListener('DOMContentLoaded', init);
