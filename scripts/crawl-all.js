#!/usr/bin/env node

/**
 * Run all crawlers in parallel, merge and deduplicate results
 * Usage: node scripts/crawl-all.js [--profile path/to/profile.json]
 * Output: JSON array of RawContent to stdout
 */

import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    execFile('node', [scriptPath, ...args], { timeout: 60000 }, (err, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr);
      if (err) {
        process.stderr.write(`[crawl-all] ${scriptPath} failed: ${err.message}\n`);
        resolve([]); // don't fail the whole pipeline
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        process.stderr.write(`[crawl-all] ${scriptPath} returned invalid JSON\n`);
        resolve([]);
      }
    });
  });
}

function deduplicate(items) {
  const seen = new Set();
  return items.filter(item => {
    // Dedupe by normalized title
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  // Load profile if provided
  const profileIdx = process.argv.indexOf('--profile');
  const profilePath = profileIdx !== -1 ? process.argv[profileIdx + 1] : null;
  let profile = null;
  if (profilePath) {
    try {
      profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
      process.stderr.write(`[crawl-all] Loaded profile: ${profile.id} (${profile.type})\n`);
    } catch (err) {
      process.stderr.write(`[crawl-all] Failed to load profile: ${err.message}\n`);
    }
  }

  // Base crawlers (always run)
  const crawlers = [
    resolve(__dirname, 'crawl-hn.js'),
    resolve(__dirname, 'crawl-rss.js'),
    resolve(__dirname, 'crawl-github.js'),
    resolve(__dirname, 'crawl-reddit.js'),
    resolve(__dirname, 'crawl-producthunt.js'),
    resolve(__dirname, 'crawl-huggingface.js'),
    resolve(__dirname, 'crawl-devto.js'),
    resolve(__dirname, 'crawl-v2ex.js'),
    resolve(__dirname, 'crawl-bilibili.js'),
    resolve(__dirname, 'crawl-weibo.js'),
    resolve(__dirname, 'crawl-youtube.js'),
    resolve(__dirname, 'crawl-tiktok.js'),
    resolve(__dirname, 'crawl-instagram.js'),
    [resolve(__dirname, 'crawl-x-kol.js'), ['ai']],
    [resolve(__dirname, 'crawl-x-kol.js'), ['crypto']],
  ];

  // Brand-specific crawlers (only when profile has the config)
  if (profile?.brand?.brandSearch) {
    crawlers.push([resolve(__dirname, 'crawl-brand-mentions.js'), ['--profile', profilePath]]);
  }
  if (profile?.brand?.github?.repos?.length) {
    crawlers.push([resolve(__dirname, 'crawl-github-releases.js'), ['--profile', profilePath]]);
  }

  const results = await Promise.all(crawlers.map(c =>
    Array.isArray(c) ? runScript(c[0], c[1]) : runScript(c)
  ));
  const merged = deduplicate(results.flat());

  console.log(JSON.stringify(merged, null, 2));
  process.stderr.write(`[crawl-all] Total: ${merged.length} items (deduped)\n`);
}

main().catch(err => {
  process.stderr.write(`[crawl-all] Error: ${err.message}\n`);
  process.exit(1);
});
