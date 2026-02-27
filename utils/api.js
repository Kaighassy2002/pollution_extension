import { syncGet } from './storage.js';
import { STORAGE, SAVE_MODE, DEFAULT_BACKEND_URL } from './constants.js';

/**
 * POST a formatted certificate record to the GreenLine FastAPI backend.
 * Reads backendUrl and authToken from chrome.storage.sync.
 */
export async function sendToBackend(record) {
  const sync = await syncGet([STORAGE.BACKEND_URL, STORAGE.AUTH_TOKEN]);
  const baseUrl = (sync[STORAGE.BACKEND_URL] || DEFAULT_BACKEND_URL).replace(/\/$/, '');
  const token   = sync[STORAGE.AUTH_TOKEN];

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}/certificates/from-scrape`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(record),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Append a certificate record as a row to a Google Sheet via Sheets API v4.
 * Reads sheetsId and sheetsApiKey from chrome.storage.sync.
 */
export async function sendToSheets(record) {
  const sync   = await syncGet([STORAGE.SHEETS_ID, STORAGE.SHEETS_API_KEY]);
  const sheetId = sync[STORAGE.SHEETS_ID];
  const apiKey  = sync[STORAGE.SHEETS_API_KEY];

  if (!sheetId || !apiKey) {
    throw new Error('Google Sheets not configured. Open Settings to add your Sheet ID and API key.');
  }

  const values = [[
    record.vehicleNo,
    record.mobile || '',
    record.validFrom  || '',
    record.validUpto  || '',
    record.rate,
    new Date().toISOString(),
  ]];

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1:append?valueInputOption=USER_ENTERED&key=${apiKey}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ values }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Sheets error: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Save a record using whichever mode is configured (backend or sheets).
 */
export async function saveRecord(record) {
  const sync = await syncGet([STORAGE.SAVE_MODE]);
  const mode = sync[STORAGE.SAVE_MODE] || SAVE_MODE.BACKEND;
  return mode === SAVE_MODE.SHEETS ? sendToSheets(record) : sendToBackend(record);
}
