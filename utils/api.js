import { syncGet, syncSet } from './storage.js';
import { STORAGE, DEFAULT_BACKEND_URL } from './constants.js';

/** Message shown when the stored Google Sheets token is expired or invalid. */
export const SHEETS_SESSION_EXPIRED_MSG =
  'Google Sheets sign-in has expired. Open the extension popup, disconnect Google Sheets, then connect again to sign in.';

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
 * Verify access to an existing Google Spreadsheet and return its title.
 * Throws a user-friendly error if the sheet cannot be accessed.
 */
export async function verifySheetsSpreadsheet(token, spreadsheetId) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 403 || res.status === 404) {
    throw new Error('Cannot access that spreadsheet. Make sure it is owned by or shared with this Google account.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Sheets API error: HTTP ${res.status}`);
  }
  const data = await res.json();
  return { title: data.properties?.title || spreadsheetId };
}

/**
 * Check whether a spreadsheet has a sheet (tab) named "Records" (used for appending rows).
 */
async function spreadsheetHasRecordsSheet(token, spreadsheetId) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title))`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  const titles = (data.sheets || []).map((s) => s.properties?.title).filter(Boolean);
  return titles.includes('Records');
}

/**
 * Find an existing "GreenLeaf PUC Records" spreadsheet the user can access.
 * Uses Drive API to list spreadsheets by name, then verifies each has a "Records" sheet.
 * Returns { spreadsheetId, title } or null if none found.
 */
export async function findExistingGreenLeafSheet(token) {
  const nameQuery = "name contains 'GreenLeaf PUC Records'";
  const q = `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and ${nameQuery}`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&fields=files(id,name)&pageSize=10`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const files = data.files || [];
  for (const f of files) {
    if (!f.id) continue;
    const hasRecords = await spreadsheetHasRecordsSheet(token, f.id);
    if (hasRecords) {
      const info = await verifySheetsSpreadsheet(token, f.id).catch(() => null);
      return info ? { spreadsheetId: f.id, title: info.title } : null;
    }
  }
  return null;
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
 * Refresh the Google Sheets access token using the stored refresh_token via the backend.
 * Returns the new access_token or null if refresh failed.
 */
export async function refreshSheetsTokenIfPossible() {
  const sync = await syncGet([
    STORAGE.BACKEND_URL,
    STORAGE.SHEETS_REFRESH_TOKEN,
  ]);
  const baseUrl = (sync[STORAGE.BACKEND_URL] || DEFAULT_BACKEND_URL).replace(/\/$/, '');
  const refreshToken = sync[STORAGE.SHEETS_REFRESH_TOKEN];
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${baseUrl}/auth/sheets-refresh`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refresh_token: refreshToken }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success || !json.data?.access_token) return null;
    await syncSet({ [STORAGE.SHEETS_ACCESS_TOKEN]: json.data.access_token });
    return json.data.access_token;
  } catch {
    return null;
  }
}

/**
 * Append a certificate record as a new row to the connected Google Spreadsheet.
 * On 401, attempts one token refresh via backend if available, then retries.
 */
export async function sendToSheets(record) {
  let sync = await syncGet([
    STORAGE.SHEETS_SPREADSHEET_ID,
    STORAGE.SHEETS_ACCESS_TOKEN,
  ]);
  let spreadsheetId = sync[STORAGE.SHEETS_SPREADSHEET_ID];
  let token         = sync[STORAGE.SHEETS_ACCESS_TOKEN];

  if (!spreadsheetId) {
    throw new Error('Google Sheets not connected. Open the extension and click "Connect Google Sheets".');
  }
  if (!token) {
    throw new Error(SHEETS_SESSION_EXPIRED_MSG);
  }

  const values = [[
    record.vehicleNo,
    record.mobile || '',
    record.validFrom  || '',
    record.validUpto  || '',
    record.rate != null ? String(record.rate) : '',
    new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
  ]];

  const doAppend = async (accessToken) => {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Records:append?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method:  'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values }),
    });
    return { res, body: await res.json().catch(() => ({})) };
  };

  let result = await doAppend(token);

  if (!result.res.ok) {
    const msg = result.body.error?.message || '';
    const isAuthError = result.res.status === 401 ||
      /invalid authentication credentials|Expected OAuth 2 access token/i.test(msg);
    if (isAuthError) {
      const newToken = await refreshSheetsTokenIfPossible();
      if (newToken) {
        result = await doAppend(newToken);
        if (result.res.ok) return result.body;
      }
      await syncSet({ [STORAGE.SHEETS_ACCESS_TOKEN]: null });
      throw new Error(SHEETS_SESSION_EXPIRED_MSG);
    }
    throw new Error(msg || `Sheets error: HTTP ${result.res.status}`);
  }
  return result.body;
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
 * Save a record to all active destinations.
 * Requirement: when the extension is connected to Google Sheets, the record is always
 * written to that sheet (in addition to GreenLeaf backend if connected).
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
