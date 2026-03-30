#!/usr/bin/env node

/**
 * Generate image via BNBot API (Nano Banana / Gemini)
 * Auth: auto-reads ~/.clawmoney/config.yaml API key (same as bnbot login)
 * Usage: node scripts/generate-image.js --prompt "description" [--model nano-banana] [--output path.png]
 * Output: Saves image to file, prints result JSON to stdout
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { homedir } from 'os';
import proxyFetch from './lib/fetch.js';

const API_BASE = 'https://api.bnbot.ai/api/v1';

function getArg(name) {
  const idx = process.argv.indexOf('--' + name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

const prompt = getArg('prompt');
const model = getArg('model') || 'nano-banana';
const outputPath = getArg('output') || `data/images/${Date.now()}.png`;

if (!prompt) {
  process.stderr.write('Usage: node generate-image.js --prompt "..." [--model nano-banana|nano-banana-pro] [--output path.png]\n');
  process.exit(1);
}

/**
 * Get auth token from clawmoney API key
 */
async function getToken() {
  // 1. Check env var first
  if (process.env.BNBOT_TOKEN) return process.env.BNBOT_TOKEN;

  // 2. Read ~/.bnbot/auth.json (saved by bnbot-auth.js login)
  const authPath = resolve(homedir(), '.bnbot', 'auth.json');
  if (!existsSync(authPath)) {
    throw new Error('Not logged in. Run: node <skill-path>/scripts/bnbot-auth.js login --email you@example.com');
  }

  const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
  if (!auth.access_token) {
    throw new Error('Invalid auth. Run: node <skill-path>/scripts/bnbot-auth.js login --email you@example.com');
  }

  return auth.access_token;
}

async function generateImage(token) {
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('model', model);

  const res = await proxyFetch(`${API_BASE}/ai/generate-image`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API ${res.status}: ${error}`);
  }

  const data = await res.json();
  const imageData = data.data?.[0];
  if (!imageData?.b64_json) throw new Error('No image data in response');

  // Save to file
  const buffer = Buffer.from(imageData.b64_json, 'base64');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);

  return {
    path: outputPath,
    mimeType: imageData.mime_type || 'image/png',
    model: data.model,
    creditsUsed: data.credits_used,
    creditsRemaining: data.credits_remaining,
  };
}

try {
  const token = await getToken();
  const result = await generateImage(token);
  console.log(JSON.stringify(result, null, 2));
  process.stderr.write(`[generate-image] Saved to ${result.path} (${result.creditsUsed} credits)\n`);
} catch (err) {
  process.stderr.write(`[generate-image] Error: ${err.message}\n`);
  process.exit(1);
}
