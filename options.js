import { STORAGE } from './utils/constants.js';
import { syncGet, syncSet } from './utils/storage.js';

async function load() {
  const sync = await syncGet([STORAGE.AUTH_TOKEN]);
  document.getElementById('authToken').value = sync[STORAGE.AUTH_TOKEN] || '';
}

async function save() {
  const saveBtn    = document.getElementById('saveBtn');
  const feedbackEl = document.getElementById('saveFeedback');
  const token      = document.getElementById('authToken').value.trim();

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  feedbackEl.textContent = '';

  try {
    await syncSet({ [STORAGE.AUTH_TOKEN]: token });
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
  document.getElementById('saveBtn').addEventListener('click', save);
});
