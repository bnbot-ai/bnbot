#!/usr/bin/env node

/**
 * BNBot authentication — login and save token locally
 * Usage: node scripts/bnbot-auth.js login --email you@example.com
 *        node scripts/bnbot-auth.js token   (prints current token)
 * Token saved to: ~/.bnbot/auth.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';
import proxyFetch from './lib/fetch.js';

const API_BASE = 'https://api.bnbot.ai/api/v1';
const AUTH_PATH = join(homedir(), '.bnbot', 'auth.json');

function loadAuth() {
  try {
    if (existsSync(AUTH_PATH)) return JSON.parse(readFileSync(AUTH_PATH, 'utf-8'));
  } catch {}
  return null;
}

function saveAuth(data) {
  mkdirSync(join(homedir(), '.bnbot'), { recursive: true });
  writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2) + '\n');
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

async function login(email) {
  // Step 1: Send verification code
  process.stderr.write(`Sending verification code to ${email}...\n`);
  const sendRes = await proxyFetch(`${API_BASE}/send-verification-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(10000),
  });

  if (!sendRes.ok) {
    throw new Error(`Failed to send code: ${sendRes.status}`);
  }

  process.stderr.write('Code sent! Check your email.\n');

  // Step 2: Get code from user
  const code = await prompt('Enter verification code: ');
  if (!code) throw new Error('Code is required');

  // Step 3: Verify and get tokens
  const loginRes = await proxyFetch(`${API_BASE}/email-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
    signal: AbortSignal.timeout(10000),
  });

  if (!loginRes.ok) {
    const err = await loginRes.json().catch(() => ({}));
    throw new Error(err.detail || `Login failed: ${loginRes.status}`);
  }

  const data = await loginRes.json();

  // Save locally
  saveAuth({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    email: data.user?.email || email,
    saved_at: new Date().toISOString(),
  });

  process.stderr.write(`Logged in as ${data.user?.email || email}\n`);
  process.stderr.write(`Token saved to ${AUTH_PATH}\n`);
  console.log(JSON.stringify({ success: true, email: data.user?.email || email }));
}

async function getToken() {
  const auth = loadAuth();
  if (!auth?.access_token) {
    process.stderr.write('Not logged in. Run: node scripts/bnbot-auth.js login --email you@example.com\n');
    process.exit(1);
  }
  console.log(auth.access_token);
}

// ── Main ──
const command = process.argv[2];

if (command === 'login') {
  let email = process.argv.find((_, i, a) => a[i - 1] === '--email');
  if (!email) email = await prompt('Email: ');
  if (!email) { process.stderr.write('Email required\n'); process.exit(1); }
  await login(email);
} else if (command === 'token') {
  await getToken();
} else {
  process.stderr.write('Usage:\n  node bnbot-auth.js login --email you@example.com\n  node bnbot-auth.js token\n');
  process.exit(1);
}
