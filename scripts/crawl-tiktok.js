#!/usr/bin/env node

/**
 * Crawl TikTok trending content
 * Requires: opencli (npm install -g @jackwener/opencli)
 * Fallback: ScrapeCreators API (SCRAPECREATORS_API_KEY)
 * Usage: node scripts/crawl-tiktok.js
 * Output: JSON array of RawContent to stdout
 */

import proxyFetch from './lib/fetch.js';
import { runOpencli } from './lib/opencli.js';

const TOP_N = 20;

// ── Strategy 1: opencli (best — uses browser login state) ───

async function tryOpencli() {
  const data = await runOpencli(['tiktok', 'explore', '-f', 'json', '--limit', String(TOP_N)]);
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  process.stderr.write(`[crawl-tiktok] Using opencli (${data.length} results)\n`);
  return data.map((v, rank) => ({
    id: `tiktok-${v.id || rank}`,
    source: 'tiktok-trending',
    sourceUrl: v.url || v.link || '',
    title: (v.desc || v.description || v.title || '').slice(0, 200),
    body: v.desc || v.description || '',
    image: v.cover || v.thumbnail || null,
    tags: ['tiktok', 'video', ...(v.hashtags?.map(h => h.name || h) || []).slice(0, 5)],
    rank: rank + 1,
    metrics: {
      views: v.playCount || v.views || 0,
      likes: v.diggCount || v.likes || 0,
      comments: v.commentCount || v.comments || 0,
      shares: v.shareCount || v.shares || 0,
    },
    author: v.author?.nickname || v.author?.uniqueId || v.authorName || '',
    crawledAt: new Date().toISOString(),
    publishedAt: v.createTime ? new Date(v.createTime * 1000).toISOString() : v.publishedAt || null,
    language: 'en',
  }));
}

// ── Strategy 2: ScrapeCreators API (needs key) ──────────────

async function tryScrapeCreators() {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await proxyFetch('https://api.scrapecreators.com/v2/tiktok/trending?count=' + TOP_N, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videos = data.data || data.items || data;
    if (!Array.isArray(videos) || !videos.length) return null;

    process.stderr.write(`[crawl-tiktok] Using ScrapeCreators (${videos.length} results)\n`);
    return videos.slice(0, TOP_N).map((v, rank) => ({
      id: `tiktok-${v.id || rank}`,
      source: 'tiktok-trending',
      sourceUrl: v.url || `https://www.tiktok.com/@${v.author?.uniqueId}/video/${v.id}`,
      title: (v.desc || v.title || '').slice(0, 200),
      body: v.desc || '',
      image: v.cover || v.thumbnail || null,
      tags: ['tiktok', 'video', ...(v.hashtags?.map(h => h.name) || []).slice(0, 5)],
      rank: rank + 1,
      metrics: {
        views: v.playCount || v.stats?.playCount || 0,
        likes: v.diggCount || v.stats?.diggCount || 0,
        comments: v.commentCount || v.stats?.commentCount || 0,
        shares: v.shareCount || v.stats?.shareCount || 0,
      },
      author: v.author?.nickname || v.author?.uniqueId || '',
      crawledAt: new Date().toISOString(),
      publishedAt: v.createTime ? new Date(v.createTime * 1000).toISOString() : null,
      language: 'en',
    }));
  } catch {
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────

const results = await tryOpencli() || await tryScrapeCreators() || [];

if (results.length === 0) {
  process.stderr.write('[crawl-tiktok] Failed — opencli not installed or not connected. Run: npm install -g @jackwener/opencli\n');
}

console.log(JSON.stringify(results, null, 2));
process.stderr.write(`[crawl-tiktok] Fetched ${results.length} videos\n`);
