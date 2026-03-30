#!/usr/bin/env node

/**
 * Crawl Dev.to top articles (free API, no key needed)
 * Usage: node scripts/crawl-devto.js
 * Output: JSON array of RawContent to stdout
 */

import proxyFetch from './lib/fetch.js';

const TOP_N = 15;

async function crawl() {
  // Dev.to public API — top articles from the last day
  const res = await proxyFetch('https://dev.to/api/articles?top=1&per_page=' + TOP_N, {
    headers: { 'User-Agent': 'bnbot-editor/0.1' },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Dev.to API ${res.status}`);
  const articles = await res.json();

  return articles.map((a, rank) => ({
    id: `devto-${a.id}`,
    source: 'dev.to',
    sourceUrl: a.url,
    title: a.title,
    body: a.description || '',
    image: a.cover_image || a.social_image || null,
    tags: a.tag_list || [],
    rank: rank + 1,
    metrics: {
      likes: a.public_reactions_count || 0,
      comments: a.comments_count || 0,
      readingTime: a.reading_time_minutes || 0,
    },
    author: a.user?.name || a.user?.username || '',
    crawledAt: new Date().toISOString(),
    publishedAt: a.published_at || null,
    language: 'en',
  }));
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-devto] Fetched ${results.length} articles\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-devto] Error: ${err.message}\n`);
    process.exit(1);
  });
