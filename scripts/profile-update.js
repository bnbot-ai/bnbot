#!/usr/bin/env node

/**
 * Update a field in a profile JSON file
 * Usage: node scripts/profile-update.js --profile <path> --set "brand.github.lastChecked" --value "2026-03-29T00:00:00Z"
 */

import { readFileSync, writeFileSync } from 'fs';

function getArg(name) {
  const idx = process.argv.indexOf('--' + name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

const profilePath = getArg('profile');
const fieldPath = getArg('set');
const value = getArg('value');

if (!profilePath || !fieldPath || value === null) {
  process.stderr.write('Usage: node profile-update.js --profile <path> --set "field.path" --value "value"\n');
  process.exit(1);
}

const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));

// Set nested field by dot path
const keys = fieldPath.split('.');
let obj = profile;
for (let i = 0; i < keys.length - 1; i++) {
  if (!(keys[i] in obj)) obj[keys[i]] = {};
  obj = obj[keys[i]];
}

// Try to parse value as JSON (for objects/arrays/booleans/numbers), fallback to string
try {
  obj[keys[keys.length - 1]] = JSON.parse(value);
} catch {
  obj[keys[keys.length - 1]] = value;
}

writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n');
console.log(JSON.stringify({ updated: fieldPath, value: obj[keys[keys.length - 1]] }));
