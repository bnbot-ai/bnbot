#!/usr/bin/env node

/**
 * Tweet history manager — track published tweets to avoid repeats
 * Usage:
 *   node scripts/history.js add --topic "AI sycophancy" --source "hackernews" --url "https://..." --text "tweet text..."
 *   node scripts/history.js list [--days 7]
 *   node scripts/history.js check --topic "AI sycophancy"
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = resolve(__dirname, '../data/history.json');

function load() {
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function save(data) {
  writeFileSync(HISTORY_PATH, JSON.stringify(data, null, 2) + '\n');
}

function getArg(name) {
  const idx = process.argv.indexOf('--' + name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

const command = process.argv[2];

if (command === 'add') {
  const entry = {
    topic: getArg('topic') || '',
    source: getArg('source') || '',
    url: getArg('url') || '',
    text: getArg('text') || '',
    date: new Date().toISOString(),
  };
  const history = load();
  history.push(entry);
  save(history);
  console.log(JSON.stringify(entry, null, 2));

} else if (command === 'list') {
  const days = parseInt(getArg('days') || '30');
  const cutoff = Date.now() - days * 86400000;
  const history = load().filter(h => new Date(h.date).getTime() > cutoff);
  console.log(JSON.stringify(history, null, 2));

} else if (command === 'check') {
  const topic = (getArg('topic') || '').toLowerCase();
  const days = parseInt(getArg('days') || '14');
  const cutoff = Date.now() - days * 86400000;
  const history = load().filter(h => new Date(h.date).getTime() > cutoff);

  const similar = history.filter(h =>
    h.topic.toLowerCase().includes(topic) ||
    topic.includes(h.topic.toLowerCase()) ||
    h.text.toLowerCase().includes(topic)
  );

  if (similar.length > 0) {
    console.log(JSON.stringify({ duplicate: true, matches: similar }, null, 2));
  } else {
    console.log(JSON.stringify({ duplicate: false }, null, 2));
  }

} else {
  console.error('Usage: node history.js <add|list|check> [--topic ...] [--source ...] [--url ...] [--text ...] [--days N]');
  process.exit(1);
}
