export const MSG = {
  SCRAPED_DATA:     'SCRAPED_DATA',
  SAVE_DATA:        'SAVE_DATA',
  SAVE_PENDING:     'SAVE_PENDING',
  COMPLETE_PENDING: 'COMPLETE_PENDING',
  GET_PENDING:      'GET_PENDING',
  GET_SCRAPED:      'GET_SCRAPED',
  GET_LATEST_SAVED: 'GET_LATEST_SAVED',
};

export const STORAGE = {
  // local
  LATEST_SCRAPED:  'latestScrapedData',
  LATEST_SAVED:    'latestSavedData',
  PENDING_RECORDS: 'pendingRecords',
  TOTAL_SYNCED:    'totalSynced',
  // sync (config — never put tokens in local)
  SAVE_MODE:       'saveMode',
  BACKEND_URL:     'backendUrl',
  AUTH_TOKEN:      'authToken',
  SHEETS_ID:       'sheetsId',
  SHEETS_API_KEY:  'sheetsApiKey',
};

export const SAVE_MODE = {
  BACKEND: 'backend',
  SHEETS:  'sheets',
};

export const DEFAULT_BACKEND_URL = 'https://api.greenline.in';
