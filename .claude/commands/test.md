Run the extension quality checks (ESLint acts as the test gate for plain JS MV3 extensions).

```bash
cd pollution_extension

# Lint — zero warnings required
npx eslint . --ext .js --max-warnings=0

# Check for XSS risk: raw innerHTML usage without escapeHtml
grep -rn "innerHTML" --include="*.js" . | grep -v "escapeHtml\|\.innerHTML\s*=\s*''" || echo "innerHTML usage looks safe"

# Check message passing contract — all sendResponse calls return structured objects
grep -n "sendResponse" background.js popup.js

# Check for hardcoded URLs (should use chrome.storage.sync.backendUrl)
grep -n "pollution-server\|onrender\.com\|localhost" background.js utils/api.js 2>/dev/null || echo "No hardcoded URLs found"
```

Review output manually. There is no automated unit test runner for this MV3 extension — lint + these checks are the quality gate.