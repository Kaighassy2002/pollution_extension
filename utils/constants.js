export const MSG = {
  SCRAPED_DATA:     'SCRAPED_DATA',
  SAVE_DATA:        'SAVE_DATA',
  SAVE_PENDING:     'SAVE_PENDING',
  COMPLETE_PENDING: 'COMPLETE_PENDING',
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
};

export const DEFAULT_BACKEND_URL = 'https://api.greenleaf.in';
