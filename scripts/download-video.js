#!/usr/bin/env node

/**
 * Download videos via yt-dlp (YouTube, TikTok, Instagram, Bilibili, etc.)
 * Requires: yt-dlp (brew install yt-dlp / pip install yt-dlp)
 *
 * Usage:
 *   node scripts/download-video.js <url>
 *   node scripts/download-video.js <url> --audio-only
 *   node scripts/download-video.js <url> --output data/videos/my-video.mp4
 *   node scripts/download-video.js <url> --format 720
 *
 * Output: JSON with downloaded file info to stdout
 */

import { execFile } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(__dirname, '..', 'data', 'videos');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { url: null, output: null, audioOnly: false, format: null, cookies: true };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') opts.output = args[++i];
    else if (args[i] === '--audio-only') opts.audioOnly = true;
    else if (args[i] === '--format' || args[i] === '-f') opts.format = args[++i];
    else if (args[i] === '--no-cookies') opts.cookies = false;
    else if (!args[i].startsWith('-')) opts.url = opts.url || args[i];
  }
  return opts;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

const opts = parseArgs();

if (!opts.url) {
  console.error('Usage: node download-video.js <url> [--output path] [--audio-only] [--format 720]');
  process.exit(1);
}

// Ensure output directory exists
const outDir = opts.output ? dirname(resolve(opts.output)) : DEFAULT_DIR;
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Build yt-dlp args
const ytArgs = [];

if (opts.audioOnly) {
  ytArgs.push('-x', '--audio-format', 'mp3');
} else if (opts.format) {
  // e.g. "720" → best video up to 720p + best audio
  ytArgs.push('-f', `bestvideo[height<=${opts.format}]+bestaudio/best[height<=${opts.format}]`);
}

// Output template
const outputTemplate = opts.output
  ? resolve(opts.output)
  : `${DEFAULT_DIR}/%(title).50s.%(ext)s`;

// Use Chrome cookies by default (YouTube requires login)
if (opts.cookies) {
  ytArgs.push('--cookies-from-browser', 'chrome');
}

ytArgs.push(
  '-o', outputTemplate,
  '--no-playlist',
  '--print', 'after_move:filepath',  // print final path after download
  '--no-simulate',
  opts.url,
);

try {
  process.stderr.write(`[download] ${opts.url}\n`);
  const filepath = await run('yt-dlp', ytArgs);

  const result = {
    url: opts.url,
    file: filepath,
    audioOnly: opts.audioOnly,
  };

  console.log(JSON.stringify(result, null, 2));
  process.stderr.write(`[download] Saved: ${filepath}\n`);
} catch (e) {
  console.error(JSON.stringify({ error: e.message, url: opts.url }));
  process.exit(1);
}
