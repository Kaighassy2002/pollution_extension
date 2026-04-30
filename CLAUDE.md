# CLAUDE.md — GreenLine Extension

Cross-browser MV3 extension (Chrome, Firefox, Opera) that scrapes vehicle PUC certificate data from `puc.parivahan.gov.in` and saves it to either Google Sheets or the GreenLine backend.

## Stack
- Manifest V3, plain JavaScript
- `chrome.storage.sync` for config, `chrome.storage.local` for pending queue
- Build step via `build.js` (Node.js, no external bundler) — produces `dist/<browser>/`
- Dev dependency: `web-ext` (Mozilla) for Firefox live reload and packaging

## Directory Structure

```
pollution_extension/
├── background.js          # service worker — all state + API logic
├── content.js             # scraper — runs on PUC portal page
├── popup.html / popup.js  # daily-use staff UI
├── options.html / options.js  # settings: save mode, backend URL
├── pending.html / pending.js  # full-page pending records manager
├── utils/
│   ├── constants.js       # MSG types, storage keys
│   ├── storage.js         # chrome.storage helpers
│   ├── api.js             # backend / Google Sheets client
│   └── date.js            # DD/MM/YYYY ↔ ISO 8601 conversion
├── icons/
│
├── manifests/             # browser-specific manifests (source of truth)
│   ├── chrome.json        # MV3 + oauth2 + externally_connectable
│   ├── firefox.json       # MV3 + browser_specific_settings (no oauth2 key)
│   └── opera.json         # MV3 + oauth2 + externally_connectable
│
├── build.js               # copies root → dist/<browser>/ + injects manifest
├── package.json           # build:*, package:* scripts
└── manifest.json          # Chrome copy at root — for quick unpacked dev only
```

## Build & Package

```bash
npm install               # installs web-ext

node build.js chrome      # → dist/chrome/
node build.js firefox     # → dist/firefox/
node build.js opera       # → dist/opera/
node build.js             # all three

npm run package:all       # → packages/greenleaf-{chrome,firefox,opera}.zip
```

See `README.md` for full publishing instructions per store.

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
- Vehicle number: `^[A-Z]{2}[0-9]{1,2}(?:[A-Z]{1,3})?[0-9]{4}$` (supports modern KL15AB1234 and old-style KL154674)
- Mobile (if provided): exactly 10 digits
- Rate: strip `"Rs."`, parse as integer

## Permissions Policy

Current: `storage`, `notifications`, `identity`, `tabs`. Host permission locked to the PUC portal URL only.

Never add: `webRequest`, `history`, `browsingData`, `<all_urls>`. Any new permission requires changes to all three manifests in `manifests/` and re-review on every store.

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
