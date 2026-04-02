export const MSG = {
  SCRAPED_DATA:     'SCRAPED_DATA',
  SAVE_DATA:        'SAVE_DATA',
  SAVE_PENDING:     'SAVE_PENDING',
  COMPLETE_PENDING: 'COMPLETE_PENDING',
  DISCARD_PENDING:  'DISCARD_PENDING',
  GET_PENDING:      'GET_PENDING',
  GET_SCRAPED:      'GET_SCRAPED',
  GET_LATEST_SAVED: 'GET_LATEST_SAVED',
  // Google Sheets OAuth
  CONNECT_SHEETS:    'CONNECT_SHEETS',
  DISCONNECT_SHEETS: 'DISCONNECT_SHEETS',
  GET_SHEETS_STATUS: 'GET_SHEETS_STATUS',
  // GreenLeaf backend
  CONNECT_GREENLEAF:    'CONNECT_GREENLEAF',
  DISCONNECT_GREENLEAF: 'DISCONNECT_GREENLEAF',
  GET_GREENLEAF_STATUS: 'GET_GREENLEAF_STATUS',
};

export const STORAGE = {
  // local
  LATEST_SCRAPED:  'latestScrapedData',
  LATEST_SAVED:    'latestSavedData',
  PENDING_RECORDS: 'pendingRecords',
  TOTAL_SYNCED:    'totalSynced',
  // sync — Google Sheets OAuth
  SHEETS_CONNECTED:        'sheetsConnected',
  SHEETS_EMAIL:            'sheetsEmail',
  SHEETS_SPREADSHEET_ID:   'sheetsSpreadsheetId',
  SHEETS_SPREADSHEET_NAME: 'sheetsSpreadsheetName',
  // sync — GreenLeaf backend
  GREENLEAF_CONNECTED: 'greenleafConnected',
  GREENLEAF_EMAIL:     'greenleafEmail',
  BACKEND_URL:         'backendUrl',
  AUTH_TOKEN:          'authToken',
  // sync — Google Sheets access token (from launchWebAuthFlow or backend refresh)
  SHEETS_ACCESS_TOKEN: 'sheetsAccessToken',
  // sync — Google Sheets refresh token (from backend token exchange; used to get new access_token)
  SHEETS_REFRESH_TOKEN: 'sheetsRefreshToken',
  // sync — true if sheet was newly created, false if existing was linked
  SHEETS_IS_NEW: 'sheetsIsNew',
};

export const DEFAULT_BACKEND_URL = 'https://greenleaf-backend-vl8v.onrender.com';
// Frontend app URL — must match externally_connectable in manifest.json
export const APP_URL = 'https://greenleaf-frontend.vercel.app/';

// Google OAuth Web Application client ID — used for the Sheets connect flow.
// Create at: Google Cloud Console → APIs & Services → Credentials → Web Application.
// Add https://<ext-id>.chromiumapp.org/ as an authorised redirect URI.
// Find your extension ID at chrome://extensions (Developer Mode on).
export const GOOGLE_SHEETS_CLIENT_ID = '325807504865-tmjhutbd5mmg5gunf58ak6ccm99qdg4s.apps.googleusercontent.com';
