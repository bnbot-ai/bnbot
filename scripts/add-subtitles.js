#!/usr/bin/env node

/**
 * Add subtitles to a video using Whisper (speech-to-text) + ffmpeg (burn-in)
 * Requires: whisper (pip install openai-whisper), ffmpeg (brew install ffmpeg)
 *
 * Usage:
 *   node scripts/add-subtitles.js <video>
 *   node scripts/add-subtitles.js <video> --model small
 *   node scripts/add-subtitles.js <video> --language zh
 *   node scripts/add-subtitles.js <video> --srt-only          # only generate .srt, don't burn
 *   node scripts/add-subtitles.js <video> --srt path/to.srt   # use existing .srt, skip whisper
 *   node scripts/add-subtitles.js <video> --output out.mp4
 *
 * Output: JSON with file paths to stdout
 */

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { video: null, model: 'small', language: null, srtOnly: false, srt: null, output: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' || args[i] === '-m') opts.model = args[++i];
    else if (args[i] === '--language' || args[i] === '--lang') opts.language = args[++i];
    else if (args[i] === '--srt-only') opts.srtOnly = true;
    else if (args[i] === '--srt') opts.srt = args[++i];
    else if (args[i] === '--output' || args[i] === '-o') opts.output = args[++i];
    else if (!args[i].startsWith('-')) opts.video = opts.video || args[i];
  }
  return opts;
}

function run(cmd, args, timeout = 600000) {
  return new Promise((resolve, reject) => {
    process.stderr.write(`[subtitles] Running: ${cmd} ${args.join(' ')}\n`);
    execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

const opts = parseArgs();

if (!opts.video) {
  console.error('Usage: node add-subtitles.js <video> [--model small] [--language zh] [--srt-only] [--srt file.srt] [--output out.mp4]');
  process.exit(1);
}

const videoPath = resolve(opts.video);
if (!existsSync(videoPath)) {
  console.error(JSON.stringify({ error: `File not found: ${videoPath}` }));
  process.exit(1);
}

const dir = dirname(videoPath);
const name = basename(videoPath, extname(videoPath));

// Step 1: Generate or use existing .srt
let srtPath;

if (opts.srt) {
  srtPath = resolve(opts.srt);
  if (!existsSync(srtPath)) {
    console.error(JSON.stringify({ error: `SRT not found: ${srtPath}` }));
    process.exit(1);
  }
  process.stderr.write(`[subtitles] Using existing SRT: ${srtPath}\n`);
} else {
  // Generate with whisper
  process.stderr.write(`[subtitles] Generating subtitles with whisper (model: ${opts.model})...\n`);

  const whisperArgs = [videoPath, '--model', opts.model, '--output_format', 'srt', '--output_dir', dir];
  if (opts.language) whisperArgs.push('--language', opts.language);

  try {
    await run('whisper', whisperArgs);
  } catch (e) {
    console.error(JSON.stringify({ error: `Whisper failed: ${e.message}` }));
    process.exit(1);
  }

  srtPath = join(dir, `${name}.srt`);
  if (!existsSync(srtPath)) {
    console.error(JSON.stringify({ error: `Whisper finished but SRT not found at ${srtPath}` }));
    process.exit(1);
  }
  process.stderr.write(`[subtitles] SRT generated: ${srtPath}\n`);
}

// Step 2: Burn subtitles into video (unless --srt-only)
if (opts.srtOnly) {
  console.log(JSON.stringify({ srt: srtPath, video: videoPath }, null, 2));
  process.exit(0);
}

const outputPath = opts.output ? resolve(opts.output) : join(dir, `${name}_subtitled${extname(videoPath)}`);

process.stderr.write(`[subtitles] Burning subtitles into video...\n`);

try {
  // Use subtitles filter with force_style for readable subtitles
  const escapedSrt = srtPath.replace(/'/g, "'\\''").replace(/:/g, '\\:');
  await run('ffmpeg', [
    '-i', videoPath,
    '-vf', `subtitles='${escapedSrt}':force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,MarginV=30'`,
    '-c:a', 'copy',
    '-y',
    outputPath,
  ]);
} catch (e) {
  console.error(JSON.stringify({ error: `ffmpeg failed: ${e.message}` }));
  process.exit(1);
}

const result = {
  video: videoPath,
  srt: srtPath,
  output: outputPath,
  model: opts.srt ? 'existing' : opts.model,
  language: opts.language || 'auto',
};

console.log(JSON.stringify(result, null, 2));
process.stderr.write(`[subtitles] Done: ${outputPath}\n`);
