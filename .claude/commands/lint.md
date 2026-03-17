Run ESLint across the extension codebase.

```bash
cd pollution_extension
npx eslint . --ext .js --max-warnings=0
npx prettier --check .
```

Fix any reported issues. ESLint is the quality gate — zero warnings allowed.