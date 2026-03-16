#!/usr/bin/env node
'use strict';

/**
 * Build script — assembles a browser-specific extension package.
 *
 * Usage:
 *   node build.js chrome          # build Chrome only
 *   node build.js firefox         # build Firefox only
 *   node build.js opera           # build Opera only
 *   node build.js                 # build all three browsers
 */

const fs   = require('fs');
const path = require('path');

const BROWSERS = ['chrome', 'firefox', 'opera'];

// These entries at the repo root are build/dev artefacts — not shipped to users.
const EXCLUDE = new Set([
  'dist',
  'manifests',
  'packages',
  'node_modules',
  'build.js',
  'package.json',
  'package-lock.json',
  '.git',
  '.gitignore',
  '.idea',
  '.claude',
  'CLAUDE.md',
  'README.md',
  'content.js.bak',
]);

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function build(browser) {
  const manifestSrc = path.join(__dirname, 'manifests', `${browser}.json`);
  if (!fs.existsSync(manifestSrc)) {
    console.error(`ERROR: manifests/${browser}.json not found`);
    process.exit(1);
  }

  const dist = path.join(__dirname, 'dist', browser);
  console.log(`Building ${browser} → dist/${browser}/`);

  // Wipe previous build
  fs.rmSync(dist, { recursive: true, force: true });

  // Copy all source files
  copyDir(__dirname, dist);

  // Overwrite manifest.json with the browser-specific one
  fs.copyFileSync(manifestSrc, path.join(dist, 'manifest.json'));

  console.log(`  done: dist/${browser}/`);
}

const arg = process.argv[2];

if (arg && !BROWSERS.includes(arg)) {
  console.error(`Unknown browser "${arg}". Valid targets: ${BROWSERS.join(', ')}`);
  process.exit(1);
}

const targets = arg ? [arg] : BROWSERS;
for (const browser of targets) {
  build(browser);
}
