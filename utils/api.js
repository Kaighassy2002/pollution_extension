import { syncGet } from './storage.js';
import { STORAGE, DEFAULT_BACKEND_URL } from './constants.js';

/**
 * Get a Google OAuth token via chrome.identity.
 */
function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!token) {
        reject(new Error('Could not obtain Google auth token. Please reconnect.'));
      } else {
        resolve(token);
      }
    });
  });
}

/**
 * Fetch the Google account email for the currently authed user.
 */
export async function getGoogleUserEmail(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Could not fetch Google account info');
  const data = await res.json();
  return data.email;
}

/**
 * Create a new Google Spreadsheet named "GreenLeaf PUC Records <year>"
 * with a header row. Returns { spreadsheetId, title }.
 */
export async function createSheetsSpreadsheet(token) {
  const year  = new Date().getFullYear();
  const title = `GreenLeaf PUC Records ${year}`;

  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title },
      sheets: [{
        properties: { title: 'Records' },
        data: [{
          startRow: 0,
          startColumn: 0,
          rowData: [{
            values: [
              { userEnteredValue: { stringValue: 'Vehicle No' } },
              { userEnteredValue: { stringValue: 'Mobile' } },
              { userEnteredValue: { stringValue: 'Issued' } },
              { userEnteredValue: { stringValue: 'Expires' } },
              { userEnteredValue: { stringValue: 'Fee (₹)' } },
              { userEnteredValue: { stringValue: 'Saved At' } },
            ],
          }],
        }],
      }],
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Sheets API error: HTTP ${res.status}`);
  }
  const data = await res.json();
  return { spreadsheetId: data.spreadsheetId, title };
}

/**
 * Append a certificate record as a new row to the connected Google Spreadsheet.
 */
export async function sendToSheets(record) {
  const token = await getAuthToken(false);

  const sync = await syncGet([STORAGE.SHEETS_SPREADSHEET_ID]);
  const spreadsheetId = sync[STORAGE.SHEETS_SPREADSHEET_ID];
  if (!spreadsheetId) {
    throw new Error('Google Sheets not connected. Open the extension and click "Connect Google Sheets".');
  }

  const values = [[
    record.vehicleNo,
    record.mobile || '',
    record.validFrom  || '',
    record.validUpto  || '',
    record.rate != null ? String(record.rate) : '',
    new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
  ]];

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Records:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ values }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Sheets error: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * POST a formatted certificate record to the GreenLeaf FastAPI backend.
 */
export async function sendToBackend(record) {
  const sync    = await syncGet([STORAGE.BACKEND_URL, STORAGE.AUTH_TOKEN]);
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
 * Save a record to all active destinations (GreenLeaf and/or Google Sheets).
 * Throws only if every destination fails.
 */
export async function saveRecord(record) {
  const sync = await syncGet([STORAGE.GREENLEAF_CONNECTED, STORAGE.SHEETS_CONNECTED]);

  const destinations = [];
  if (sync[STORAGE.GREENLEAF_CONNECTED]) destinations.push(() => sendToBackend(record));
  if (sync[STORAGE.SHEETS_CONNECTED])    destinations.push(() => sendToSheets(record));

  if (destinations.length === 0) {
    throw new Error('No destination configured. Connect Google Sheets or GreenLeaf from the extension popup.');
  }

  const results  = await Promise.allSettled(destinations.map(fn => fn()));
  const failures = results.filter(r => r.status === 'rejected');

  if (failures.length === destinations.length) {
    throw new Error(failures.map(f => f.reason.message).join(' | '));
  }
  // At least one succeeded — partial failures are non-fatal
}
