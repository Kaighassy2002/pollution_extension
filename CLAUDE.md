# CLAUDE.md — GreenLine Extension

Chrome MV3 extension that scrapes vehicle PUC certificate data from `puc.parivahan.gov.in` and saves it to either Google Sheets or the GreenLine backend.

## Stack
- Chrome Manifest V3, plain JavaScript (no build step)
- `chrome.storage.sync` for config, `chrome.storage.local` for pending queue
- No npm dependencies beyond dev tooling (eslint, prettier)

## Directory Structure

```
pollution_extension/
├── manifest.json
├── background.js          # service worker — all state + API logic
├── content.js             # scraper — runs on PUC portal page
├── popup.html / popup.js  # daily-use staff UI
├── options.html / options.js  # settings: save mode, backend URL
├── utils/
│   ├── constants.js       # MSG types, storage keys
│   ├── storage.js         # chrome.storage helpers
│   ├── api.js             # backend / Google Sheets client
│   └── date.js            # DD/MM/YYYY ↔ ISO 8601 conversion
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Save Mode Architecture

Configured in `options.html`. Stored in `chrome.storage.sync` under key `saveMode`.

- `"sheets"` — Append to Google Sheet via Sheets API v4 (user-provided API key). No backend call.
- `"backend"` — POST to `POST /api/v1/certificates/` (requires Google OAuth in extension).

Storage keys (all in `chrome.storage.sync`):
- `saveMode` — `"sheets"` | `"backend"`
- `backendUrl` — configurable base URL (default: `https://api.greenline.in`)
- `authToken` — session JWT from backend (never the raw Google token)
- `sheetsApiKey` / `sheetsId` — Google Sheets credentials

Never store raw Google OAuth tokens in `chrome.storage.local`. Sensitive config always in `.sync`.

## Message Passing Contract

All messages between `content.js`, `background.js`, and `popup.js` use typed objects defined in `utils/constants.js`.

```js
// utils/constants.js
const MSG = {
  SCRAPED_DATA:      "SCRAPED_DATA",       // content → background
  SAVE_DATA:         "SAVE_DATA",           // popup → background
  SAVE_PENDING:      "SAVE_PENDING",        // popup → background
  COMPLETE_PENDING:  "COMPLETE_PENDING",    // popup → background
  GET_PENDING:       "GET_PENDING",         // popup → background
  GET_LATEST_SAVED:  "GET_LATEST_SAVED",    // popup → background
};
```

Every `sendResponse` callback must return `{ success: boolean, data?: any, error?: string }`. Never return raw strings or unstructured objects.

## DOM Scraping Resilience

Current selectors in `content.js` target specific IDs (`#j_idt34`, `#j_idt17`, `#j_idt25`, `#feesID`) which change on portal updates. Use fallback selectors:

```js
function scrapeField(primarySelector, fallbackSelectors = []) {
  for (const sel of [primarySelector, ...fallbackSelectors]) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return null;
}
```

Report missing fields back to `background.js` as `{ success: false, error: "FIELD_MISSING", field: "vehicleNo" }`. Never silently swallow missing fields.

## Data Formatting

PUC portal returns dates as `DD/MM/YYYY`. All conversion to ISO 8601 (`YYYY-MM-DD`) lives in `utils/date.js`. The `formatRecordForBackend` logic currently in `background.js` must be extracted there.

Input validation before backend submission:
- Vehicle number: `^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$`
- Mobile (if provided): exactly 10 digits
- Rate: strip `"Rs."`, parse as integer

## Permissions Policy

Current: `storage`, `notifications`. Host permission locked to the PUC portal URL only.

Never add: `tabs`, `webRequest`, `history`, `browsingData`, `<all_urls>`. Any new permission requires manifest change + Chrome Web Store re-review.

## UI Conventions (Popup)

The popup is the primary daily-use interface for center staff. Target design:
- Width: 380px
- Brand color: `#059669` (emerald-600) for primary actions
- Amber `#f59e0b` for pending/warning states
- Minimal layout — vehicle number, dates, rate visible at a glance
- Clear success/error feedback after save (inline, not alert dialogs)
- Disable buttons during async operations (prevent double-submit)
- XSS prevention via `escapeHtml()` on all scraped data rendered to DOM

## Commit Convention

```
feat(extension): add fallback selectors for DOM scraping
fix(background): handle auth token expiry
refactor(content): extract date parsing to utils/date.js
```

Scopes: `extension`, `scraper`, `background`, `popup`, `options`, `storage`.

Do **not** include a `Co-Authored-By` trailer in any commit message.

## Agents

### extension-security-auditor
```
Review the extension codebase for security issues:
- Check chrome.storage usage: sensitive data (tokens, API keys) must be in .sync not .local
- Verify all DOM-rendered scraped data is escaped via escapeHtml()
- Check manifest.json permissions — no over-broad host permissions
- Check background.js API calls use HTTPS only
- Verify no raw Google OAuth tokens are stored or logged
- Check options.html inputs are validated before saving to storage
Output findings as CRITICAL / HIGH / MEDIUM / LOW. Do not modify files.
```
