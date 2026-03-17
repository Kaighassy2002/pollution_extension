# GreenLeaf — PUC Tracker Extension

A Chrome extension (also works on Firefox and Opera) that automatically reads vehicle PUC certificate data from the government portal `puc.parivahan.gov.in` and saves it to the GreenLeaf backend.

---

## How it works

1. Staff opens the PUC portal and looks up a vehicle
2. The extension automatically reads the certificate details from the page
3. Staff enters the owner's mobile number and clicks Save
4. The certificate is saved to GreenLeaf

---

## Using it in Chrome (no commands needed)

This is the simplest way — no Node.js or terminal required.

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `pollution_extension/` folder (the root of this repo)
5. The extension appears in your toolbar

Every time you change a source file, go back to `chrome://extensions` and click the reload button on the extension card.

---

## Why there are build commands (and when you need them)

The extension supports three browsers — Chrome, Firefox, and Opera. Each browser needs a slightly different `manifest.json` (the file that tells the browser what the extension is and what permissions it needs).

The build step solves this: it copies all source files into a `dist/<browser>/` folder and drops in the correct manifest for that browser.

```
Source files (root/)  →  node build.js chrome  →  dist/chrome/   ← load this in Chrome
                      →  node build.js firefox →  dist/firefox/  ← load this in Firefox
                      →  node build.js opera   →  dist/opera/    ← load this in Opera
```

**You only need this if you are developing for Firefox or Opera, or packaging for store submission.** For everyday Chrome development, loading from the root folder works fine.

---

## Setting up the build tools (one time only)

You need Node.js installed. Then run this once inside the `pollution_extension/` folder:

```bash
npm install
```

This downloads one tool called `web-ext` (used for Firefox only) into a local `node_modules/` folder.

---

## Build commands

```bash
node build.js chrome     # copies files to dist/chrome/
node build.js firefox    # copies files to dist/firefox/
node build.js opera      # copies files to dist/opera/
node build.js            # builds all three at once
```

These are shortcuts for the same thing:

```bash
npm run build:chrome
npm run build:firefox
npm run build:opera
npm run build:all
```

After building, load the extension from the `dist/<browser>/` folder in your browser.

---

## Loading in Firefox and Opera

**Firefox:**
1. Run `node build.js firefox`
2. Go to `about:debugging` → **This Firefox** → **Load Temporary Add-on**
3. Select `dist/firefox/manifest.json`

**Opera:**
1. Run `node build.js opera`
2. Go to `opera://extensions` → turn on Developer mode → **Load unpacked**
3. Select `dist/opera/`

### Firefox live reload (auto-reloads on every file change)

```bash
node build.js firefox
npm start
```

`npm start` launches a temporary Firefox window with the extension already loaded. When you rebuild, it reloads automatically — no manual steps needed. **This only works for Firefox.**

---

## Packaging for store submission

If you ever want to publish the extension to a browser store, you need to create a zip file. First create the output folder:

```bash
mkdir -p packages
```

Then package:

```bash
npm run package:chrome    # → packages/greenleaf-chrome.zip
npm run package:firefox   # → packages/greenleaf-firefox.zip
npm run package:opera     # → packages/greenleaf-opera.zip

npm run package:all       # all three at once
```

Upload the zip to the relevant store dashboard.

---

## Publishing to stores

### Chrome Web Store
1. `npm run package:chrome`
2. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Click **Add new item** → upload `packages/greenleaf-chrome.zip`
4. Fill in the store listing and submit (review takes 1–3 business days)

### Firefox Add-ons (AMO)
1. `npm run package:firefox`
2. Go to [addons.mozilla.org/developers](https://addons.mozilla.org/en-US/developers/)
3. Click **Submit a New Add-on** → upload `packages/greenleaf-firefox.zip`
4. Review takes 1–7 days

> The `browser_specific_settings.gecko.id` in `manifests/firefox.json` is a permanent ID for the Firefox listing (e.g. `greenleaf-puc@yourdomain.com`). Never change it after the first submission — Firefox uses it to match updates to the right listing.

### Opera Add-ons
1. `npm run package:opera`
2. Go to [addons.opera.com/developer](https://addons.opera.com/developer/)
3. Click **Submit** → upload `packages/greenleaf-opera.zip`
4. Review takes 1–5 business days

---

## Before each store submission — version bump

Update the version number in four places:

```
manifests/chrome.json   →  "version": "1.2"
manifests/firefox.json  →  "version": "1.2"
manifests/opera.json    →  "version": "1.2"
package.json            →  "version": "1.2.0"
```

---

## One-time Google Sheets OAuth setup

> This is only needed if the Google Sheets integration is enabled. It is currently disabled.

The Google Sheets feature uses Google OAuth to get permission to write to a spreadsheet. Each browser installation gets a unique extension ID, and Google needs to know that ID before the login flow will work.

**Step 1 — Find your extension ID**

| Browser | Where to find it |
|---------|-----------------|
| Chrome  | `chrome://extensions` (Developer mode on) |
| Firefox | `about:debugging` after loading the add-on |
| Opera   | `opera://extensions` (Developer mode on) |

**Step 2 — Get the redirect URI**

This is the URL Google will send the user back to after they log in.

| Browser | Redirect URI format |
|---------|---------------------|
| Chrome  | `https://<extension-id>.chromiumapp.org/` |
| Firefox | `https://<extension-id>.extensions.allizom.org/` |
| Opera   | `https://<extension-id>.chromiumapp.org/` |

To get the exact value, open the browser console inside the extension and run:
```js
chrome.identity.getRedirectURL()
```

**Step 3 — Register it in Google Cloud Console**

1. Go to **APIs & Services → Credentials → OAuth 2.0 Client IDs**
2. Create or edit a **Web Application** client
3. Add the redirect URI under **Authorised redirect URIs**
4. Copy the **Client ID**

**Step 4 — Put the Client ID in the code**

For Chrome and Opera, open `manifests/chrome.json` (or `opera.json`) and replace the placeholder:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com"
}
```

For Firefox, open `utils/constants.js` and set:

```js
export const GOOGLE_SHEETS_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
```

---

## Files in this repo

```
pollution_extension/
├── background.js          # runs in the background — handles saving, storage, auth
├── content.js             # reads certificate data from the PUC portal page
├── popup.html / popup.js  # the extension popup staff use every day
├── options.html / options.js  # settings page (backend URL, save mode)
├── pending.html / pending.js  # full-page view of unsaved records
├── utils/
│   ├── constants.js       # message types and storage key names
│   ├── storage.js         # helpers for reading/writing chrome.storage
│   ├── api.js             # calls to GreenLeaf backend and Google Sheets
│   └── date.js            # converts DD/MM/YYYY dates to YYYY-MM-DD
├── icons/
├── manifests/
│   ├── chrome.json        # Chrome/Edge manifest
│   ├── firefox.json       # Firefox manifest
│   └── opera.json         # Opera manifest
├── build.js               # assembles dist/<browser>/ folders
└── package.json           # npm scripts and web-ext dependency
```

`dist/` and `packages/` are generated — they are not committed to git.

---

## Browser support

| Feature | Chrome | Firefox | Opera |
|---------|--------|---------|-------|
| Extension works | Yes | Yes (109+) | Yes |
| Auto-reloads on file change | No | Yes (via `npm start`) | No |
| Receives token from web app | Yes | Yes | Yes |
