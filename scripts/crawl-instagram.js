#!/usr/bin/env node

/**
 * Crawl Instagram trending/explore content
 * Requires: opencli with Instagram adapter, or SCRAPECREATORS_API_KEY
 * Usage: node scripts/crawl-instagram.js
 * Output: JSON array of RawContent to stdout
 */

import proxyFetch from './lib/fetch.js';
import { runOpencli } from './lib/opencli.js';

const TOP_N = 15;

async function tryOpencli() {
  const data = await runOpencli(['instagram', 'explore', '-f', 'json', '--limit', String(TOP_N)]);
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  process.stderr.write(`[crawl-ig] Using opencli (${data.length} results)\n`);
  return data.map((post, rank) => ({
    id: `ig-${post.id || post.shortcode || rank}`,
    source: 'instagram',
    sourceUrl: post.url || post.link || `https://www.instagram.com/p/${post.shortcode}`,
    title: (post.caption || post.text || '').slice(0, 120),
    body: (post.caption || post.text || '').slice(0, 500),
    image: post.thumbnail || post.displayUrl || post.image || null,
    tags: ['instagram', ...(post.hashtags || []).slice(0, 5)],
    rank: rank + 1,
    metrics: {
      likes: post.likeCount || post.likes || 0,
      comments: post.commentCount || post.comments || 0,
      views: post.viewCount || post.views || 0,
    },
    author: post.owner?.username || post.author || '',
    crawledAt: new Date().toISOString(),
    publishedAt: post.timestamp ? new Date(post.timestamp * 1000).toISOString() : post.publishedAt || null,
    language: 'en',
  }));
}

async function tryScrapeCreators() {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await proxyFetch('https://api.scrapecreators.com/v2/instagram/trending?count=' + TOP_N, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const posts = data.data || data.items || data;
    if (!Array.isArray(posts) || !posts.length) return null;

    process.stderr.write(`[crawl-ig] Using ScrapeCreators (${posts.length} results)\n`);
    return posts.slice(0, TOP_N).map((post, rank) => ({
      id: `ig-${post.id || rank}`,
      source: 'instagram',
      sourceUrl: post.url || '',
      title: (post.caption || '').slice(0, 120),
      body: (post.caption || '').slice(0, 500),
      image: post.thumbnail || post.displayUrl || null,
      tags: ['instagram', ...(post.hashtags?.map(h => h.name) || []).slice(0, 5)],
      rank: rank + 1,
      metrics: {
        likes: post.likeCount || 0,
        comments: post.commentCount || 0,
      },
      author: post.owner?.username || '',
      crawledAt: new Date().toISOString(),
      publishedAt: post.timestamp ? new Date(post.timestamp * 1000).toISOString() : null,
      language: 'en',
    }));
  } catch {
    return null;
  }
}

const results = await tryOpencli() || await tryScrapeCreators() || [];

if (results.length === 0) {
  process.stderr.write('[crawl-ig] All sources unavailable (install opencli or set SCRAPECREATORS_API_KEY)\n');
}

console.log(JSON.stringify(results, null, 2));
process.stderr.write(`[crawl-ig] Fetched ${results.length} posts\n`);
