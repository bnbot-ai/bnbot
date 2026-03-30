#!/usr/bin/env node

/**
 * Crawl Reddit hot posts from configured subreddits
 * Uses public JSON API (no OAuth needed for reading)
 * Usage: node scripts/crawl-reddit.js
 * Output: JSON array of RawContent to stdout
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import proxyFetch from './lib/fetch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '../config/sources.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

const subreddits = config.reddit?.subreddits || ['technology', 'programming'];
const TOP_N = config.reddit?.topN || 10;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

async function fetchSubreddit(subreddit) {
  try {
    const url = `https://old.reddit.com/r/${subreddit}/hot.json?limit=${TOP_N}&raw_json=1`;
    const res = await proxyFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      process.stderr.write(`[crawl-reddit] r/${subreddit} HTTP ${res.status}\n`);
      return [];
    }

    const data = await res.json();
    const posts = data?.data?.children || [];
    const cutoff = Date.now() - MAX_AGE_MS;

    return posts
      .map(p => p.data)
      .filter(p => !p.stickied && p.created_utc * 1000 > cutoff)
      .map(p => ({
        id: `reddit-${p.id}`,
        source: `reddit:r/${subreddit}`,
        sourceUrl: `https://reddit.com${p.permalink}`,
        title: p.title,
        body: (p.selftext || '').slice(0, 500),
        image: extractImage(p),
        tags: [subreddit, ...(p.link_flair_text ? [p.link_flair_text] : [])],
        metrics: {
          upvotes: p.ups || 0,
          comments: p.num_comments || 0,
          upvoteRatio: p.upvote_ratio || 0,
        },
        author: p.author || '',
        crawledAt: new Date().toISOString(),
        publishedAt: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null,
        language: 'en',
      }));
  } catch (err) {
    process.stderr.write(`[crawl-reddit] r/${subreddit} failed: ${err.message}\n`);
    return [];
  }
}

function extractImage(post) {
  // Reddit thumbnail
  if (post.thumbnail && post.thumbnail.startsWith('http') && !post.thumbnail.includes('default')) {
    // Prefer higher-res preview
    const preview = post.preview?.images?.[0]?.source?.url;
    if (preview) return preview;
    return post.thumbnail;
  }
  // Link to image
  if (post.url && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(post.url)) {
    return post.url;
  }
  return null;
}

async function crawl() {
  // Stagger requests slightly to avoid rate limiting
  const results = [];
  for (const sub of subreddits) {
    const posts = await fetchSubreddit(sub);
    results.push(...posts);
    // Small delay between subreddits
    await new Promise(r => setTimeout(r, 500));
  }

  // Dedupe by title (cross-posted content)
  const seen = new Set();
  return results.filter(item => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-reddit] Fetched ${results.length} posts from ${subreddits.length} subreddits\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-reddit] Error: ${err.message}\n`);
    process.exit(1);
  });
