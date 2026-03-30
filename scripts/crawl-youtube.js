#!/usr/bin/env node

/**
 * Crawl YouTube trending/popular videos
 * Requires: opencli (npm install -g @jackwener/opencli)
 * Fallback: RSS channel feeds
 * Usage: node scripts/crawl-youtube.js
 * Output: JSON array of RawContent to stdout
 */

import Parser from 'rss-parser';
import proxyFetch from './lib/fetch.js';
import { runOpencli } from './lib/opencli.js';

// ── Strategy 1: opencli (best results) ──────────────────────

async function tryOpencli() {
  const data = await runOpencli(['youtube', 'search', 'trending tech AI 2026', '-f', 'json', '--limit', '20']);
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  process.stderr.write(`[crawl-yt] Using opencli (${data.length} results)\n`);
  return data.map((v, rank) => ({
    id: `yt-${v.id || v.videoId || rank}`,
    source: 'youtube',
    sourceUrl: v.url || v.link || `https://www.youtube.com/watch?v=${v.id || v.videoId}`,
    title: v.title || '',
    body: (v.description || v.snippet || '').slice(0, 500),
    image: v.thumbnail || v.thumbnailUrl || (v.id ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : null),
    tags: ['youtube', 'video', ...(v.tags || []).slice(0, 5)],
    rank: rank + 1,
    metrics: {
      views: v.views || v.viewCount || 0,
      likes: v.likes || v.likeCount || 0,
      comments: v.comments || v.commentCount || 0,
    },
    author: v.channel || v.channelTitle || v.author || '',
    crawledAt: new Date().toISOString(),
    publishedAt: v.publishedAt || v.uploaded || null,
    language: 'en',
  }));
}

// ── Strategy 2: RSS channel feeds (fallback) ────────────────

const CHANNELS = [
  { id: 'UCWN3xxRkmTPphYnPVaKYkuw', name: 'Fireship' },
  { id: 'UCVHFbqXqoYvEWM1Ddxl0QDg', name: 'AI Explained' },
  { id: 'UCZgt6AzoyjslHTC9dz0UoTw', name: 'ByteByteGo' },
  { id: 'UCq-Fj5jknLsUf-MWSy4_brA', name: 'Two Minute Papers' },
  { id: 'UCHnyfMqiRRG1u-2MsSQLbXA', name: 'Veritasium' },
  { id: 'UCBcRF18a7Qf58cCRy5xuWwQ', name: 'MKBHD' },
  { id: 'UC4QZ_LsYcvcq7qOsOhpAI4A', name: 'ColdFusion' },
  { id: 'UCR-DXc1voovS8nhAvccRZhg', name: 'Jeff Geerling' },
];

const MAX_AGE_MS = 48 * 60 * 60 * 1000;

async function tryRSSFeeds() {
  const results = [];
  for (const channel of CHANNELS) {
    try {
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;
      const res = await proxyFetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;

      const xml = await res.text();
      const parser = new Parser();
      const feed = await parser.parseString(xml);
      const cutoff = Date.now() - MAX_AGE_MS;

      const items = (feed.items || [])
        .filter(item => new Date(item.pubDate || item.isoDate || 0).getTime() > cutoff)
        .slice(0, 3)
        .map(item => {
          const videoId = item.id?.split(':')?.[2] || item.link?.match(/v=([^&]+)/)?.[1] || '';
          return {
            id: `yt-${videoId}`,
            source: 'youtube',
            sourceUrl: item.link || `https://www.youtube.com/watch?v=${videoId}`,
            title: item.title || '',
            body: (item.contentSnippet || '').replace(/<[^>]*>/g, '').slice(0, 500),
            image: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            tags: ['youtube', 'video'],
            rank: 0,
            metrics: {},
            author: channel.name || '',
            crawledAt: new Date().toISOString(),
            publishedAt: item.pubDate || item.isoDate || null,
            language: 'en',
          };
        });
      results.push(...items);
    } catch {}
  }

  results.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  results.forEach((item, i) => item.rank = i + 1);
  return results.length > 0 ? results : null;
}

// ── Main ─────────────────────────────────────────────────────

const results = await tryOpencli() || await tryRSSFeeds() || [];

console.log(JSON.stringify(results, null, 2));
process.stderr.write(`[crawl-yt] Fetched ${results.length} videos\n`);
