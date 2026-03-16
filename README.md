# GreenLeaf — PUC Tracker Extension

Chrome MV3 extension (also works on Firefox and Opera) that scrapes vehicle PUC certificate data from `puc.parivahan.gov.in` and saves it to the GreenLeaf backend or Google Sheets.

---

## Repository layout

```
pollution_extension/
├── background.js          # service worker / background script
├── content.js             # scraper — runs on the PUC portal page
├── popup.html / popup.js  # daily-use staff UI
├── options.html / options.js
├── pending.html / pending.js
├── utils/                 # shared helpers (constants, storage, api, date)
├── icons/
│
├── manifests/             # one manifest per browser
│   ├── chrome.json        # MV3 + oauth2 + externally_connectable
│   ├── firefox.json       # MV3 + browser_specific_settings (no oauth2)
│   └── opera.json         # MV3 + oauth2 + externally_connectable
│
├── build.js               # assembles dist/<browser>/ from root + right manifest
├── package.json
└── .gitignore             # excludes dist/, packages/, node_modules/
```

Source files live at the root. `build.js` copies them into `dist/<browser>/` and drops in the correct `manifest.json`. `dist/` and `packages/` are never committed.

---

## Prerequisites

- Node.js 18+
- `npm install` (installs `web-ext`)
- `zip` CLI available on PATH (for Chrome/Opera packaging)

```bash
npm install
```

---

## Development

### Load unpacked (any browser)

Build the target first, then load from `dist/<browser>/`.

```bash
node build.js chrome
# Chrome: chrome://extensions → Load unpacked → select dist/chrome/

node build.js firefox
# Firefox: about:debugging → Load Temporary Add-on → select dist/firefox/manifest.json

node build.js opera
# Opera: opera://extensions → Load unpacked → select dist/opera/
```

### Live reload in Firefox

```bash
npm run build:firefox
npm start          # runs: web-ext run --source-dir dist/firefox
```

`web-ext run` auto-reloads the extension on file changes when you rebuild.

---

## Building

```bash
# Single browser
npm run build:chrome
npm run build:firefox
npm run build:opera

# All three at once
npm run build:all
```

Output: `dist/chrome/`, `dist/firefox/`, `dist/opera/`

---

## Packaging for store submission

Packages land in `packages/`. Create that directory first:

```bash
mkdir -p packages
```

```bash
npm run package:chrome    # → packages/greenleaf-chrome.zip
npm run package:firefox   # → packages/greenleaf-firefox.zip  (via web-ext)
npm run package:opera     # → packages/greenleaf-opera.zip

npm run package:all       # all three
```

---

## One-time OAuth setup per browser

The Google Sheets OAuth flow uses `chrome.identity.launchWebAuthFlow`, which is supported in all three browsers. Each browser gets its own redirect URI — you must register it in Google Cloud Console.

### 1. Find your extension ID

| Browser | Where |
|---------|-------|
| Chrome  | `chrome://extensions` (Developer mode on) |
| Firefox | `about:debugging` after loading the temporary add-on |
| Opera   | `opera://extensions` (Developer mode on) |

### 2. Derive the redirect URI

| Browser | Redirect URI pattern |
|---------|----------------------|
| Chrome  | `https://<extension-id>.chromiumapp.org/` |
| Firefox | `https://<extension-id>.extensions.allizom.org/` |
| Opera   | `https://<extension-id>.chromiumapp.org/` (Chromium-based) |

Call `chrome.identity.getRedirectURL()` from the browser console inside the extension to get the exact value.

### 3. Register in Google Cloud Console

1. Go to **APIs & Services → Credentials → OAuth 2.0 Client IDs**
2. Create (or edit) a **Web Application** client
3. Add the redirect URI from step 2 under **Authorised redirect URIs**
4. Copy the **Client ID**

### 4. Set the client_id in the manifest

Open the relevant manifest and replace the placeholder:

```json
// manifests/chrome.json and manifests/opera.json
"oauth2": {
  "client_id": "YOUR_CHROME_APP_CLIENT_ID.apps.googleusercontent.com",
  ...
}
```

Firefox has no `oauth2` manifest key — the client ID is set directly in `utils/constants.js`:

```js
export const GOOGLE_SHEETS_CLIENT_ID = 'YOUR_FIREFOX_CLIENT_ID.apps.googleusercontent.com';
```

---

## Publishing

### Chrome Web Store

1. Package: `npm run package:chrome`
2. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. **Add new item** → upload `packages/greenleaf-chrome.zip`
4. Fill in store listing, screenshots, privacy policy
5. Submit for review (typically 1–3 business days)

### Firefox Add-ons (AMO)

1. Package: `npm run package:firefox`
2. Go to [addons.mozilla.org/developers](https://addons.mozilla.org/en-US/developers/)
3. **Submit a New Add-on** → upload `packages/greenleaf-firefox.zip`
4. Choose **Listed** (public) or **Unlisted** (self-distributed)
5. AMO requires source code submission for obfuscated extensions — since this is plain JS, the zip itself is sufficient
6. Review typically takes 1–7 days

**Important:** The `browser_specific_settings.gecko.id` in `manifests/firefox.json` must be a stable email-style ID (e.g. `greenleaf-puc@yourdomain.com`). AMO ties updates to this ID — never change it after first submission.

### Opera Add-ons

1. Package: `npm run package:opera`
2. Go to [addons.opera.com/developer](https://addons.opera.com/developer/)
3. **Submit** → upload `packages/greenleaf-opera.zip`
4. Opera accepts Chrome extensions directly — no special porting needed
5. Review typically takes 1–5 business days

---

## Version bumps

Update `version` in all three manifests and in `package.json` before each store submission:

```bash
# manifests/chrome.json, manifests/firefox.json, manifests/opera.json
"version": "2.1"

# package.json
"version": "2.1.0"
```

---

## Browser compatibility notes

| Feature | Chrome | Firefox | Opera |
|---------|--------|---------|-------|
| MV3 service worker | Yes | Yes (109+) | Yes |
| `chrome.identity.launchWebAuthFlow` | Yes | Yes | Yes |
| `externally_connectable` | Yes | No* | Yes |
| `oauth2` manifest key | Yes | No | Yes |
| `chrome.*` namespace | Yes | Yes (compat shim) | Yes |

\* Firefox does not support `externally_connectable`. The web app sends tokens to the extension via `browser.runtime.sendMessage(extensionId, msg)` instead, which Firefox's `runtime.onMessageExternal` handles without any manifest declaration.
