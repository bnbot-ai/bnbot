#!/usr/bin/env node

/**
 * Crawl Bilibili popular/hot videos (free API, no key needed)
 * Usage: node scripts/crawl-bilibili.js
 * Output: JSON array of RawContent to stdout
 */

import proxyFetch from './lib/fetch.js';

const TOP_N = 20;

async function crawl() {
  // Bilibili popular videos API (public, no auth)
  const res = await proxyFetch('https://api.bilibili.com/x/web-interface/popular?ps=' + TOP_N, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': 'https://www.bilibili.com',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Bilibili API ${res.status}`);
  const data = await res.json();

  if (data.code !== 0) throw new Error(`Bilibili API error: ${data.message}`);

  const videos = data.data?.list || [];

  return videos.map((v, rank) => ({
    id: `bilibili-${v.bvid}`,
    source: 'bilibili',
    sourceUrl: `https://www.bilibili.com/video/${v.bvid}`,
    title: v.title,
    body: v.desc || '',
    image: v.pic || null,
    tags: ['bilibili', ...(v.tname ? [v.tname] : [])],
    rank: rank + 1,
    metrics: {
      views: v.stat?.view || 0,
      likes: v.stat?.like || 0,
      comments: v.stat?.reply || 0,
      danmaku: v.stat?.danmaku || 0,
      favorites: v.stat?.favorite || 0,
      shares: v.stat?.share || 0,
    },
    author: v.owner?.name || '',
    crawledAt: new Date().toISOString(),
    publishedAt: v.pubdate ? new Date(v.pubdate * 1000).toISOString() : null,
    language: 'zh',
  }));
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-bilibili] Fetched ${results.length} videos\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-bilibili] Error: ${err.message}\n`);
    process.exit(1);
  });
