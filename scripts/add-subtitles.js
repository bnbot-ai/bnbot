#!/usr/bin/env node

/**
 * Add subtitles to a video using Groq Whisper API + ffmpeg
 * Requires: GROQ_API_KEY env var, ffmpeg (brew install ffmpeg)
 *
 * Usage:
 *   node scripts/add-subtitles.js <video>
 *   node scripts/add-subtitles.js <video> --language zh
 *   node scripts/add-subtitles.js <video> --srt-only
 *   node scripts/add-subtitles.js <video> --srt path/to.srt
 *   node scripts/add-subtitles.js <video> --output out.mp4
 *   node scripts/add-subtitles.js <video> --model whisper-large-v3-turbo
 *
 * Output: JSON with file paths to stdout
 */

import { execFile } from 'child_process';
import { existsSync, writeFileSync, unlinkSync, symlinkSync } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { video: null, model: 'whisper-large-v3', language: null, srtOnly: false, srt: null, output: null, url: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' || args[i] === '-m') opts.model = args[++i];
    else if (args[i] === '--language' || args[i] === '--lang') opts.language = args[++i];
    else if (args[i] === '--srt-only') opts.srtOnly = true;
    else if (args[i] === '--srt') opts.srt = args[++i];
    else if (args[i] === '--output' || args[i] === '-o') opts.output = args[++i];
    else if (args[i] === '--url') opts.url = args[++i];
    else if (!args[i].startsWith('-')) opts.video = opts.video || args[i];
  }
  return opts;
}

function run(cmd, args, timeout = 600000) {
  return new Promise((resolve, reject) => {
    process.stderr.write(`[subtitles] Running: ${cmd} ${args.join(' ')}\n`);
    execFile(cmd, args, { timeout, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function transcribeWithGroq(audioPath, model, language) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  // Use curl for reliable multipart upload
  const curlArgs = [
    '-s', 'https://api.groq.com/openai/v1/audio/transcriptions',
    '-H', `Authorization: Bearer ${apiKey}`,
    '-F', `file=@${audioPath}`,
    '-F', `model=${model}`,
    '-F', 'response_format=verbose_json',
  ];
  if (language) curlArgs.push('-F', `language=${language}`);

  const output = await run('curl', curlArgs, 120000);
  const result = JSON.parse(output);

  if (result.error) throw new Error(result.error.message || JSON.stringify(result.error));
  return result;
}

function toSrt(segments) {
  return segments.map((seg, i) => {
    const start = formatTime(seg.start);
    const end = formatTime(seg.end);
    return `${i + 1}\n${start} --> ${end}\n${seg.text.trim()}\n`;
  }).join('\n');
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad3(ms)}`;
}

function pad(n) { return n.toString().padStart(2, '0'); }
function pad3(n) { return n.toString().padStart(3, '0'); }

function parseSrt(content) {
  const segments = [];
  const blocks = content.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const timeMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!timeMatch) continue;
    const start = +timeMatch[1]*3600 + +timeMatch[2]*60 + +timeMatch[3] + +timeMatch[4]/1000;
    const end = +timeMatch[5]*3600 + +timeMatch[6]*60 + +timeMatch[7] + +timeMatch[8]/1000;
    const text = lines.slice(2).join('\n');
    segments.push({ start, end, text });
  }
  return segments;
}

// ── Main ──

const opts = parseArgs();

if (!opts.video) {
  console.error('Usage: node add-subtitles.js <video> [--language zh] [--srt-only] [--srt file.srt] [--output out.mp4]');
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
  srtPath = join(dir, `${name}.srt`);

  // Strategy 1: Try yt-dlp to download existing subtitles (YouTube, etc.)
  if (opts.url) {
    process.stderr.write(`[subtitles] Trying yt-dlp subtitles for ${opts.url}...\n`);
    try {
      const lang = opts.language || 'en';
      await run('yt-dlp', [
        '--write-sub', '--write-auto-sub',
        '--sub-lang', lang,
        '--sub-format', 'srt',
        '--skip-download',
        '--convert-subs', 'srt',
        '-o', join(dir, `${name}`),
        '--cookies-from-browser', 'chrome',
        opts.url,
      ], 30000);
      // yt-dlp outputs as <name>.<lang>.srt
      const ytSrt = join(dir, `${name}.${lang}.srt`);
      if (existsSync(ytSrt)) {
        const { renameSync } = await import('fs');
        renameSync(ytSrt, srtPath);
        process.stderr.write(`[subtitles] Got subtitles from yt-dlp\n`);
      }
    } catch {
      process.stderr.write(`[subtitles] No subtitles from yt-dlp, falling back...\n`);
    }
  }

  // Strategy 2: Groq Whisper API (fallback)
  if (!existsSync(srtPath)) {
    const audioPath = join(dir, `${name}.mp3`);
    process.stderr.write(`[subtitles] Extracting audio...\n`);

    try {
      await run('ffmpeg', ['-i', videoPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', '-y', audioPath]);
    } catch (e) {
      console.error(JSON.stringify({ error: `Audio extraction failed: ${e.message}` }));
      process.exit(1);
    }

    process.stderr.write(`[subtitles] Transcribing via Groq (${opts.model})...\n`);

    try {
      const result = await transcribeWithGroq(audioPath, opts.model, opts.language);

      if (!result.segments || result.segments.length === 0) {
        throw new Error('No segments returned');
      }

      writeFileSync(srtPath, toSrt(result.segments));
      process.stderr.write(`[subtitles] SRT generated via Groq (${result.segments.length} segments)\n`);

      try { unlinkSync(audioPath); } catch {}
    } catch (e) {
      console.error(JSON.stringify({ error: `Transcription failed: ${e.message}` }));
      process.exit(1);
    }
  }
}

// Step 2: Burn subtitles into video (unless --srt-only)
if (opts.srtOnly) {
  console.log(JSON.stringify({ srt: srtPath, video: videoPath }, null, 2));
  process.exit(0);
}

const outputPath = opts.output ? resolve(opts.output) : join(dir, `${name}_subtitled${extname(videoPath)}`);

process.stderr.write(`[subtitles] Burning subtitles into video...\n`);

try {
  // Hard-burn subtitles using libass subtitles filter.
  // Requires: brew install homebrew-ffmpeg/ffmpeg/ffmpeg
  // Use temp symlink to avoid path escaping issues with spaces/special chars.
  const tmpSrt = join(dir, `_sub${Date.now()}.srt`);
  symlinkSync(srtPath, tmpSrt);

  try {
    await run('ffmpeg', [
      '-i', videoPath,
      '-vf', `subtitles=${tmpSrt}:force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,MarginV=30'`,
      '-c:a', 'copy',
      '-y',
      outputPath,
    ]);
  } finally {
    try { unlinkSync(tmpSrt); } catch {}
  }
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
