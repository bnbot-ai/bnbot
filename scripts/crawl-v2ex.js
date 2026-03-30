#!/usr/bin/env node

/**
 * Crawl V2EX hot topics (free API, no key needed)
 * Usage: node scripts/crawl-v2ex.js
 * Output: JSON array of RawContent to stdout
 */

import proxyFetch from './lib/fetch.js';

async function crawl() {
  const res = await proxyFetch('https://www.v2ex.com/api/topics/hot.json', {
    headers: { 'User-Agent': 'bnbot-editor/0.1' },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`V2EX API ${res.status}`);
  const topics = await res.json();

  return topics.map((t, rank) => ({
    id: `v2ex-${t.id}`,
    source: 'v2ex',
    sourceUrl: t.url || `https://www.v2ex.com/t/${t.id}`,
    title: t.title,
    body: (t.content || '').slice(0, 500),
    image: t.member?.avatar_large || null,
    tags: [t.node?.title, t.node?.name, 'v2ex'].filter(Boolean),
    rank: rank + 1,
    metrics: {
      replies: t.replies || 0,
    },
    author: t.member?.username || '',
    crawledAt: new Date().toISOString(),
    publishedAt: t.created ? new Date(t.created * 1000).toISOString() : null,
    language: 'zh',
  }));
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-v2ex] Fetched ${results.length} topics\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-v2ex] Error: ${err.message}\n`);
    process.exit(1);
  });
