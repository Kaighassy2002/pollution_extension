import { STORAGE, DEFAULT_BACKEND_URL } from './utils/constants.js';
import { syncGet, syncSet } from './utils/storage.js';

async function load() {
  const sync = await syncGet([STORAGE.BACKEND_URL, STORAGE.AUTH_TOKEN]);
  document.getElementById('backendUrl').value = sync[STORAGE.BACKEND_URL] || DEFAULT_BACKEND_URL;
  document.getElementById('authToken').value  = sync[STORAGE.AUTH_TOKEN]  || '';
}

async function save() {
  const saveBtn    = document.getElementById('saveBtn');
  const feedbackEl = document.getElementById('saveFeedback');

  const url   = document.getElementById('backendUrl').value.trim();
  const token = document.getElementById('authToken').value.trim();

  if (!url) {
    document.getElementById('backendUrl').classList.add('has-error');
    feedbackEl.textContent = 'Backend URL is required';
    feedbackEl.className = 'save-feedback err';
    return;
  }
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    document.getElementById('backendUrl').classList.add('has-error');
    feedbackEl.textContent = 'URL must start with http:// or https://';
    feedbackEl.className = 'save-feedback err';
    return;
  }
  try { new URL(url); } catch {
    document.getElementById('backendUrl').classList.add('has-error');
    feedbackEl.textContent = 'Not a valid URL';
    feedbackEl.className = 'save-feedback err';
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  feedbackEl.textContent = '';

  try {
    await syncSet({ [STORAGE.BACKEND_URL]: url, [STORAGE.AUTH_TOKEN]: token });
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
  document.querySelectorAll('.field-input').forEach(input => {
    input.addEventListener('input', () => input.classList.remove('has-error'));
  });
});
