#!/usr/bin/env node

/**
 * Schedule periodic content generation
 * Usage:
 *   node scripts/schedule.js --interval 2h    # Every 2 hours
 *   node scripts/schedule.js --interval 30m   # Every 30 minutes
 *   node scripts/schedule.js --cron "0 */2 * * *"  # Cron expression
 *   node scripts/schedule.js --setup          # Install as macOS launchd service
 *
 * This script runs crawl-all.js on a schedule and saves results for
 * Claude to process later. It does NOT generate tweets automatically
 * (that requires Claude). It just keeps fresh data ready.
 */

import { execFile } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getArg(name) {
  const idx = process.argv.indexOf('--' + name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function parseInterval(str) {
  const match = str.match(/^(\d+)(m|h)$/);
  if (!match) throw new Error('Invalid interval. Use: 30m, 1h, 2h');
  const [, num, unit] = match;
  return parseInt(num) * (unit === 'h' ? 3600000 : 60000);
}

function runCrawl() {
  const profileArg = getArg('profile');
  const args = [resolve(__dirname, 'crawl-all.js')];
  if (profileArg) args.push('--profile', profileArg);

  return new Promise((resolve) => {
    execFile('node', args, { timeout: 120000 }, (err, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr);
      if (err) {
        process.stderr.write(`[schedule] Crawl failed: ${err.message}\n`);
        resolve(null);
        return;
      }
      try {
        const data = JSON.parse(stdout);
        // Save to data/latest-crawl.json
        const outPath = resolve(__dirname, '../data/latest-crawl.json');
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, JSON.stringify({
          crawledAt: new Date().toISOString(),
          count: data.length,
          items: data,
        }, null, 2));
        process.stderr.write(`[schedule] Saved ${data.length} items to ${outPath}\n`);
        resolve(data);
      } catch {
        process.stderr.write(`[schedule] Invalid JSON from crawl\n`);
        resolve(null);
      }
    });
  });
}

function generateLaunchdPlist() {
  const interval = getArg('interval') || '2h';
  const intervalSeconds = parseInterval(interval) / 1000;
  const scriptPath = resolve(__dirname, 'schedule.js');
  const profileArg = getArg('profile');

  const args = ['node', scriptPath, '--once'];
  if (profileArg) args.push('--profile', profileArg);

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.bnbot.editor.schedule</string>
  <key>ProgramArguments</key>
  <array>
    ${args.map(a => `<string>${a}</string>`).join('\n    ')}
  </array>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>StandardOutPath</key>
  <string>${homedir()}/Library/Logs/bnbot-editor.log</string>
  <key>StandardErrorPath</key>
  <string>${homedir()}/Library/Logs/bnbot-editor.log</string>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>`;

  const plistPath = resolve(homedir(), 'Library/LaunchAgents/ai.bnbot.editor.schedule.plist');
  writeFileSync(plistPath, plist);
  process.stderr.write(`[schedule] Wrote ${plistPath}\n`);
  process.stderr.write(`[schedule] Run: launchctl load ${plistPath}\n`);
  process.stderr.write(`[schedule] Stop: launchctl unload ${plistPath}\n`);
  return plistPath;
}

// ── Main ──

if (process.argv.includes('--setup')) {
  const plistPath = generateLaunchdPlist();
  console.log(JSON.stringify({ plistPath, status: 'created' }));
} else if (process.argv.includes('--once')) {
  // Single run (for cron/launchd)
  await runCrawl();
} else {
  // Loop mode
  const interval = getArg('interval') || '2h';
  const ms = parseInterval(interval);
  process.stderr.write(`[schedule] Running every ${interval} (${ms / 60000} min)\n`);

  // Run immediately
  await runCrawl();

  // Then loop
  setInterval(async () => {
    process.stderr.write(`[schedule] ${new Date().toISOString()} — running crawl\n`);
    await runCrawl();
  }, ms);
}
