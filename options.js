import { STORAGE, SAVE_MODE, DEFAULT_BACKEND_URL } from './utils/constants.js';
import { syncGet, syncSet } from './utils/storage.js';

const KEYS = [STORAGE.SAVE_MODE, STORAGE.BACKEND_URL, STORAGE.AUTH_TOKEN, STORAGE.SHEETS_ID, STORAGE.SHEETS_API_KEY];

async function load() {
  const sync = await syncGet(KEYS);

  const mode = sync[STORAGE.SAVE_MODE] || SAVE_MODE.BACKEND;
  selectMode(mode);

  document.getElementById('backendUrl').value   = sync[STORAGE.BACKEND_URL]   || DEFAULT_BACKEND_URL;
  document.getElementById('authToken').value    = sync[STORAGE.AUTH_TOKEN]    || '';
  document.getElementById('sheetsId').value     = sync[STORAGE.SHEETS_ID]     || '';
  document.getElementById('sheetsApiKey').value = sync[STORAGE.SHEETS_API_KEY] || '';
}

function selectMode(mode) {
  document.querySelectorAll('.mode-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.mode === mode);
  });
  document.getElementById('panelBackend').classList.toggle('visible', mode === SAVE_MODE.BACKEND);
  document.getElementById('panelSheets').classList.toggle('visible',  mode === SAVE_MODE.SHEETS);
}

function currentMode() {
  const selected = document.querySelector('.mode-card.selected');
  return selected ? selected.dataset.mode : SAVE_MODE.BACKEND;
}

async function save() {
  const saveBtn     = document.getElementById('saveBtn');
  const feedbackEl  = document.getElementById('saveFeedback');
  const mode        = currentMode();

  const data = {
    [STORAGE.SAVE_MODE]:      mode,
    [STORAGE.BACKEND_URL]:    document.getElementById('backendUrl').value.trim(),
    [STORAGE.AUTH_TOKEN]:     document.getElementById('authToken').value.trim(),
    [STORAGE.SHEETS_ID]:      document.getElementById('sheetsId').value.trim(),
    [STORAGE.SHEETS_API_KEY]: document.getElementById('sheetsApiKey').value.trim(),
  };

  // Validate — backend mode
  if (mode === SAVE_MODE.BACKEND) {
    const url = data[STORAGE.BACKEND_URL];
    if (!url) {
      document.getElementById('backendUrl').classList.add('has-error');
      feedbackEl.textContent = 'Backend URL is required';
      feedbackEl.className = 'save-feedback err';
      return;
    }
    if (!url.startsWith('https://')) {
      document.getElementById('backendUrl').classList.add('has-error');
      feedbackEl.textContent = 'Backend URL must start with https://';
      feedbackEl.className = 'save-feedback err';
      return;
    }
    try { new URL(url); } catch {
      document.getElementById('backendUrl').classList.add('has-error');
      feedbackEl.textContent = 'Backend URL is not a valid URL';
      feedbackEl.className = 'save-feedback err';
      return;
    }
  }

  // Validate — sheets mode
  if (mode === SAVE_MODE.SHEETS) {
    const sheetId = data[STORAGE.SHEETS_ID];
    if (!sheetId) {
      document.getElementById('sheetsId').classList.add('has-error');
      feedbackEl.textContent = 'Spreadsheet ID is required';
      feedbackEl.className = 'save-feedback err';
      return;
    }
    // Google Sheet IDs are alphanumeric with hyphens/underscores only
    if (!/^[a-zA-Z0-9_-]{20,}$/.test(sheetId)) {
      document.getElementById('sheetsId').classList.add('has-error');
      feedbackEl.textContent = 'Spreadsheet ID looks invalid — copy it from the Google Sheets URL';
      feedbackEl.className = 'save-feedback err';
      return;
    }
    const apiKey = data[STORAGE.SHEETS_API_KEY];
    if (!apiKey) {
      document.getElementById('sheetsApiKey').classList.add('has-error');
      feedbackEl.textContent = 'API Key is required for Google Sheets mode';
      feedbackEl.className = 'save-feedback err';
      return;
    }
    // Google API keys start with "AIza" and are 39 chars
    if (!/^AIza[0-9A-Za-z_-]{35}$/.test(apiKey)) {
      document.getElementById('sheetsApiKey').classList.add('has-error');
      feedbackEl.textContent = 'API Key format looks invalid — it should start with "AIza"';
      feedbackEl.className = 'save-feedback err';
      return;
    }
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  feedbackEl.textContent = '';

  try {
    await syncSet(data);
    feedbackEl.textContent = 'Settings saved';
    feedbackEl.className = 'save-feedback ok';
    setTimeout(() => { feedbackEl.textContent = ''; }, 3000);
  } catch (err) {
    feedbackEl.textContent = err.message || 'Failed to save';
    feedbackEl.className = 'save-feedback err';
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save Settings';
}

document.addEventListener('DOMContentLoaded', () => {
  load();

  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      selectMode(card.dataset.mode);
      // Clear errors on mode switch
      document.querySelectorAll('.field-input').forEach(i => i.classList.remove('has-error'));
      document.getElementById('saveFeedback').textContent = '';
    });
  });

  document.getElementById('saveBtn').addEventListener('click', save);

  // Clear error on input
  document.querySelectorAll('.field-input').forEach(input => {
    input.addEventListener('input', () => input.classList.remove('has-error'));
  });
});
