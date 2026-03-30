#!/usr/bin/env node

/**
 * Crawl Hacker News top stories via Firebase API (no API key needed)
 * Usage: node scripts/crawl-hn.js [--top N]
 * Output: JSON array of RawContent to stdout
 */

import proxyFetch from './lib/fetch.js';

const TOP_N = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--top') || '30');
const HN_API = 'https://hacker-news.firebaseio.com/v0';
const CONCURRENCY = 10;

async function fetchJSON(url) {
  const res = await proxyFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function fetchOgImage(url) {
  if (!url || url.startsWith('https://news.ycombinator.com')) return null;
  try {
    const res = await proxyFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bnbot-editor/0.1)' },
      signal: AbortSignal.timeout(5000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return ogMatch?.[1] || null;
  } catch {
    return null;
  }
}

async function pMap(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function crawl() {
  // 1. Get top story IDs
  const ids = await fetchJSON(`${HN_API}/topstories.json`);
  const topIds = ids.slice(0, TOP_N);

  // 2. Fetch details concurrently
  const stories = await pMap(topIds, async (id) => {
    try {
      return await fetchJSON(`${HN_API}/item/${id}.json`);
    } catch {
      return null;
    }
  }, CONCURRENCY);

  // 3. Fetch og:images concurrently (best-effort)
  const validStories = stories.filter(s => s && s.type === 'story');
  const images = await pMap(validStories, s => fetchOgImage(s.url), CONCURRENCY);

  // 4. Convert to unified format
  const results = validStories
    .map((story, rank) => ({
      id: `hn-${story.id}`,
      source: 'hackernews',
      sourceUrl: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
      hnUrl: `https://news.ycombinator.com/item?id=${story.id}`,
      title: story.title,
      body: '',
      image: images[rank] || null,
      tags: ['tech'],
      rank: rank + 1,
      metrics: {
        upvotes: story.score || 0,
        comments: story.descendants || 0,
      },
      author: story.by || '',
      crawledAt: new Date().toISOString(),
      publishedAt: story.time ? new Date(story.time * 1000).toISOString() : null,
      language: 'en',
    }));

  return results;
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-hn] Fetched ${results.length} stories\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-hn] Error: ${err.message}\n`);
    process.exit(1);
  });
