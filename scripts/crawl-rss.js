#!/usr/bin/env node

/**
 * Crawl RSS feeds for recent articles
 * Usage: node scripts/crawl-rss.js [--config path/to/sources.json]
 * Output: JSON array of RawContent to stdout
 */

import Parser from 'rss-parser';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import proxyFetch from './lib/fetch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = process.argv.find((_, i, a) => a[i - 1] === '--config')
  || resolve(__dirname, '../config/sources.json');

const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const feeds = config.rss?.feeds || [];
const maxAgeMs = 24 * 60 * 60 * 1000; // 24h

const parser = new Parser({
  timeout: 15000,
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
      ['enclosure', 'enclosure', { keepArray: false }],
    ],
  },
});

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

function extractImage(item) {
  // Try multiple RSS image sources
  if (item.mediaContent?.$.url) return item.mediaContent.$.url;
  if (item.mediaThumbnail?.$.url) return item.mediaThumbnail.$.url;
  if (item.enclosure?.url && item.enclosure.type?.startsWith('image')) return item.enclosure.url;
  // Try to find og:image in content HTML
  const content = item.content || item['content:encoded'] || '';
  const imgMatch = content.match(/<img[^>]+src="([^"]+)"/);
  if (imgMatch) return imgMatch[1];
  return null;
}

async function crawlFeed(feed) {
  try {
    // Use proxyFetch to get RSS XML, then parse the string
    const res = await proxyFetch(feed.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Status code ${res.status}`);
    const xml = await res.text();
    const result = await parser.parseString(xml);
    const cutoff = Date.now() - maxAgeMs;

    return (result.items || [])
      .filter(item => {
        const pub = new Date(item.pubDate || item.isoDate || 0).getTime();
        return pub > cutoff;
      })
      .slice(0, 10)
      .map(item => ({
        id: `rss-${Buffer.from(item.link || item.guid || '').toString('base64url').slice(0, 24)}`,
        source: `rss:${result.title || feed.url}`,
        sourceUrl: item.link || '',
        title: item.title || '',
        body: stripHtml(item.contentSnippet || item.content || '').slice(0, 500),
        tags: [feed.tag, ...(item.categories || [])].filter(Boolean),
        image: extractImage(item) || null,
        metrics: {},
        crawledAt: new Date().toISOString(),
        publishedAt: item.pubDate || item.isoDate || null,
        language: 'en',
      }));
  } catch (err) {
    process.stderr.write(`[crawl-rss] Failed: ${feed.url} - ${err.message}\n`);
    return [];
  }
}

async function crawl() {
  const results = await Promise.all(feeds.map(crawlFeed));
  return results.flat();
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-rss] Fetched ${results.length} articles from ${feeds.length} feeds\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-rss] Error: ${err.message}\n`);
    process.exit(1);
  });
