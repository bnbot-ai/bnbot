#!/usr/bin/env node

/**
 * Crawl Weibo hot search (free, no key needed)
 * Usage: node scripts/crawl-weibo.js
 * Output: JSON array of RawContent to stdout
 */

import proxyFetch from './lib/fetch.js';

async function crawl() {
  // Weibo hot search public API
  const res = await proxyFetch('https://weibo.com/ajax/side/hotSearch', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': 'https://weibo.com',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Weibo API ${res.status}`);
  const data = await res.json();

  const items = data.data?.realtime || [];

  return items.map((item, rank) => ({
    id: `weibo-${item.mid || rank}`,
    source: 'weibo-hot',
    sourceUrl: `https://s.weibo.com/weibo?q=${encodeURIComponent('#' + item.word + '#')}`,
    title: item.word || item.note || '',
    body: item.label_name || '',
    image: item.icon ? `https://n.sinaimg.cn/default/590/w196h396/${item.icon}` : null,
    tags: ['weibo', item.category || '', item.label_name || ''].filter(Boolean),
    rank: rank + 1,
    metrics: {
      hotness: item.num || item.raw_hot || 0,
      isNew: item.is_new === 1,
      isFei: item.is_fei === 1,
    },
    author: '',
    crawledAt: new Date().toISOString(),
    publishedAt: null,
    language: 'zh',
  }));
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-weibo] Fetched ${results.length} hot topics\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-weibo] Error: ${err.message}\n`);
    process.exit(1);
  });
