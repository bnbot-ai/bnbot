#!/usr/bin/env node

/**
 * Crawl Product Hunt today's top products via RSS feed
 * Usage: node scripts/crawl-producthunt.js
 * Output: JSON array of RawContent to stdout
 */

import Parser from 'rss-parser';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import proxyFetch from './lib/fetch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '../config/sources.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const TOP_N = config.producthunt?.topN || 15;

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

function extractImage(html) {
  const match = html?.match(/<img[^>]+src="([^"]+)"/);
  return match?.[1] || null;
}

async function crawl() {
  // Fetch RSS via proxyFetch, then parse the XML
  const res = await proxyFetch('https://www.producthunt.com/feed', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Product Hunt RSS HTTP ${res.status}`);
  const xml = await res.text();

  const parser = new Parser();
  const feed = await parser.parseString(xml);
  const items = (feed.items || []).slice(0, TOP_N);

  return items.map((item, rank) => {
    const slug = item.link?.split('/posts/')?.[1] || `ph-${rank}`;
    const image = extractImage(item.content || item['content:encoded'] || '');

    return {
      id: `ph-${slug}`,
      source: 'producthunt',
      sourceUrl: item.link || '',
      title: item.title || '',
      body: stripHtml(item.contentSnippet || item.content || '').slice(0, 500),
      image: image,
      tags: ['producthunt', 'startup', 'product'],
      rank: rank + 1,
      metrics: {},
      author: item.creator || '',
      crawledAt: new Date().toISOString(),
      publishedAt: item.pubDate || item.isoDate || null,
      language: 'en',
    };
  });
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-ph] Fetched ${results.length} products\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-ph] Error: ${err.message}\n`);
    process.exit(1);
  });
