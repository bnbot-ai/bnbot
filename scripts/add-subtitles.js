#!/usr/bin/env node

/**
 * Add subtitles to a video.
 * Subtitle priority: yt-dlp (target lang) → yt-dlp (source lang) + translate → Groq Whisper + translate
 * Requires: GROQ_API_KEY env var, ffmpeg with libass, yt-dlp
 *
 * Usage:
 *   node scripts/add-subtitles.js <video> --url <youtube-url> --language zh
 *   node scripts/add-subtitles.js <video> --language en
 *   node scripts/add-subtitles.js <video> --srt path/to.srt
 *   node scripts/add-subtitles.js <video> --srt-only
 *
 * Output: JSON with file paths to stdout
 */

import { execFile } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, symlinkSync, renameSync } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { video: null, model: 'whisper-large-v3', language: null, source: null, srtOnly: false, srt: null, output: null, url: null, fontSize: 16 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' || args[i] === '-m') opts.model = args[++i];
    else if (args[i] === '--language' || args[i] === '--lang') opts.language = args[++i];
    else if (args[i] === '--source') opts.source = args[++i];
    else if (args[i] === '--srt-only') opts.srtOnly = true;
    else if (args[i] === '--srt') opts.srt = args[++i];
    else if (args[i] === '--output' || args[i] === '-o') opts.output = args[++i];
    else if (args[i] === '--url') opts.url = args[++i];
    else if (args[i] === '--font-size') opts.fontSize = parseInt(args[++i]) || 16;
    else if (!args[i].startsWith('-')) opts.video = opts.video || args[i];
  }
  return opts;
}

function run(cmd, args, timeout = 600000) {
  return new Promise((resolve, reject) => {
    process.stderr.write(`[subtitles] ${cmd} ${args.slice(0, 3).join(' ')}...\n`);
    execFile(cmd, args, { timeout, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ── yt-dlp subtitle download ──

async function ytdlpSubs(url, lang, outputBase) {
  // Try multiple lang codes for Chinese
  const langCodes = lang === 'zh' ? 'zh-Hans,zh-CN,zh,zh-Hant,zh-TW' : lang;

  await run('yt-dlp', [
    '--write-sub', '--write-auto-sub',
    '--sub-lang', langCodes,
    '--sub-format', 'srt',
    '--skip-download',
    '--convert-subs', 'srt',
    '-o', outputBase,
    '--cookies-from-browser', 'chrome',
    url,
  ], 30000);

  // yt-dlp outputs as <name>.<lang>.srt — find which one was created
  const candidates = langCodes.split(',').map(l => `${outputBase}.${l}.srt`);
  for (const f of candidates) {
    if (existsSync(f)) return f;
  }
  return null;
}

// ── Groq Whisper API ──

async function transcribeWithGroq(audioPath, model, language) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

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

// ── Translate SRT via Groq LLM ──

async function translateSrt(srtPath, targetLang) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const srtContent = readFileSync(srtPath, 'utf-8');
  const langName = { zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German' }[targetLang] || targetLang;

  process.stderr.write(`[subtitles] Translating to ${langName}...\n`);

  const payload = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `You are a subtitle translator. Translate the following SRT subtitles to ${langName}. Keep the SRT format exactly (numbers, timestamps). Only translate the text lines. Output ONLY the translated SRT, nothing else.`,
      },
      { role: 'user', content: srtContent },
    ],
    temperature: 0.3,
  });

  const output = await run('curl', [
    '-s', 'https://api.groq.com/openai/v1/chat/completions',
    '-H', `Authorization: Bearer ${apiKey}`,
    '-H', 'Content-Type: application/json',
    '-d', payload,
  ], 60000);

  const result = JSON.parse(output);
  if (result.error) throw new Error(result.error.message || JSON.stringify(result.error));

  const translated = result.choices?.[0]?.message?.content;
  if (!translated) throw new Error('Empty translation response');

  const outPath = srtPath.replace(/\.srt$/, `.${targetLang}.srt`);
  writeFileSync(outPath, translated);
  process.stderr.write(`[subtitles] Translation saved: ${outPath}\n`);
  return outPath;
}

// ── SRT helpers ──

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

// ── Main ──

const opts = parseArgs();

if (!opts.video) {
  console.error('Usage: node add-subtitles.js <video> [--url <url>] [--language zh] [--source en] [--srt-only] [--font-size 16]');
  process.exit(1);
}

const videoPath = resolve(opts.video);
if (!existsSync(videoPath)) {
  console.error(JSON.stringify({ error: `File not found: ${videoPath}` }));
  process.exit(1);
}

const dir = dirname(videoPath);
const name = basename(videoPath, extname(videoPath));
const targetLang = opts.language || 'en';
const sourceLang = opts.source || (targetLang === 'zh' ? 'en' : null);
const needsTranslation = sourceLang && sourceLang !== targetLang;

let srtPath;
let method = '';

if (opts.srt) {
  // User provided SRT
  srtPath = resolve(opts.srt);
  if (!existsSync(srtPath)) {
    console.error(JSON.stringify({ error: `SRT not found: ${srtPath}` }));
    process.exit(1);
  }
  method = 'user-provided';
  process.stderr.write(`[subtitles] Using existing SRT: ${srtPath}\n`);
} else {
  srtPath = join(dir, `${name}.srt`);

  // Strategy 1: yt-dlp — download target language subtitles directly (FREE)
  if (opts.url) {
    process.stderr.write(`[subtitles] Strategy 1: yt-dlp → ${targetLang} subtitles...\n`);
    try {
      const found = await ytdlpSubs(opts.url, targetLang, join(dir, name));
      if (found) {
        renameSync(found, srtPath);
        method = `yt-dlp (${targetLang})`;
        process.stderr.write(`[subtitles] ✓ Got ${targetLang} subtitles from yt-dlp\n`);
      }
    } catch {
      process.stderr.write(`[subtitles] ✗ No ${targetLang} subtitles from yt-dlp\n`);
    }
  }

  // Strategy 2: yt-dlp source lang + translate (FREE subs + cheap translate)
  if (!existsSync(srtPath) && opts.url && needsTranslation) {
    process.stderr.write(`[subtitles] Strategy 2: yt-dlp → ${sourceLang} subtitles + translate...\n`);
    try {
      const srcSrtPath = join(dir, `${name}.${sourceLang}.srt`);
      const found = await ytdlpSubs(opts.url, sourceLang, join(dir, name));
      if (found) {
        if (found !== srcSrtPath) renameSync(found, srcSrtPath);
        process.stderr.write(`[subtitles] ✓ Got ${sourceLang} subtitles, translating...\n`);
        const translated = await translateSrt(srcSrtPath, targetLang);
        renameSync(translated, srtPath);
        method = `yt-dlp (${sourceLang}) + translate`;
      }
    } catch (e) {
      process.stderr.write(`[subtitles] ✗ Strategy 2 failed: ${e.message}\n`);
    }
  }

  // Strategy 3: Groq Whisper + translate (last resort)
  if (!existsSync(srtPath)) {
    process.stderr.write(`[subtitles] Strategy 3: Groq Whisper + translate...\n`);
    const audioPath = join(dir, `${name}.mp3`);

    try {
      await run('ffmpeg', ['-i', videoPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', '-y', audioPath]);
    } catch (e) {
      console.error(JSON.stringify({ error: `Audio extraction failed: ${e.message}` }));
      process.exit(1);
    }

    try {
      const whisperLang = sourceLang || targetLang;
      const result = await transcribeWithGroq(audioPath, opts.model, whisperLang);
      if (!result.segments || result.segments.length === 0) throw new Error('No segments');

      const rawSrt = join(dir, `${name}.${whisperLang}.srt`);
      writeFileSync(rawSrt, toSrt(result.segments));
      process.stderr.write(`[subtitles] ✓ Groq transcription done (${result.segments.length} segments)\n`);

      if (needsTranslation) {
        const translated = await translateSrt(rawSrt, targetLang);
        renameSync(translated, srtPath);
        method = `groq-whisper + translate`;
      } else {
        renameSync(rawSrt, srtPath);
        method = 'groq-whisper';
      }

      try { unlinkSync(audioPath); } catch {}
    } catch (e) {
      console.error(JSON.stringify({ error: `Transcription failed: ${e.message}` }));
      process.exit(1);
    }
  }
}

// Step 2: Burn subtitles into video
if (opts.srtOnly) {
  console.log(JSON.stringify({ srt: srtPath, video: videoPath, method }, null, 2));
  process.exit(0);
}

const outputPath = opts.output ? resolve(opts.output) : join(dir, `${name}_subtitled${extname(videoPath)}`);

process.stderr.write(`[subtitles] Burning subtitles (fontSize=${opts.fontSize})...\n`);

try {
  const tmpSrt = join(dir, `_sub${Date.now()}.srt`);
  symlinkSync(srtPath, tmpSrt);

  try {
    await run('ffmpeg', [
      '-i', videoPath,
      '-vf', `subtitles=${tmpSrt}:force_style='FontSize=${opts.fontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,MarginV=20'`,
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
  method,
  language: targetLang,
};

console.log(JSON.stringify(result, null, 2));
process.stderr.write(`[subtitles] Done: ${outputPath}\n`);
