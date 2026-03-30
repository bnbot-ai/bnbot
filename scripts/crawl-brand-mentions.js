#!/usr/bin/env node

/**
 * Crawl brand/competitor/industry mentions via Google News RSS
 * Usage: node scripts/crawl-brand-mentions.js --profile path/to/profile.json
 * Output: JSON array of RawContent to stdout
 */

import Parser from 'rss-parser';
import { readFileSync } from 'fs';
import { execFile } from 'child_process';
import proxyFetch from './lib/fetch.js';

const profilePath = process.argv.find((_, i, a) => a[i - 1] === '--profile');
if (!profilePath) {
  process.stderr.write('Usage: node crawl-brand-mentions.js --profile <path>\n');
  process.exit(1);
}

const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
const brandSearch = profile.brand?.brandSearch;
if (!brandSearch) {
  console.log('[]');
  process.exit(0);
}

const parser = new Parser();
const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48h for news

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

async function searchGoogleNews(query, tag) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await proxyFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const feed = await parser.parseString(xml);
    const cutoff = Date.now() - MAX_AGE_MS;

    return (feed.items || [])
      .filter(item => new Date(item.pubDate || 0).getTime() > cutoff)
      .slice(0, 5)
      .map(item => ({
        id: `brand-${Buffer.from(item.link || '').toString('base64url').slice(0, 20)}`,
        source: `brand-search:${tag}`,
        sourceUrl: item.link || '',
        title: item.title || '',
        body: stripHtml(item.contentSnippet || item.content || '').slice(0, 500),
        image: null,
        tags: [tag, 'brand-mention'],
        rank: 0,
        metrics: {},
        author: item.source?.name || '',
        crawledAt: new Date().toISOString(),
        publishedAt: item.pubDate || null,
        language: 'en',
      }));
  } catch (err) {
    process.stderr.write(`[crawl-brand] Google News failed for "${query}": ${err.message}\n`);
    return [];
  }
}

async function searchBnbotTwitter(query) {
  return new Promise((resolve) => {
    execFile('bnbot', ['scrape-search-results', '--query', query, '--tab', 'top', '--limit', '5'],
      { timeout: 15000 },
      (err, stdout) => {
        if (err) { resolve([]); return; }
        try {
          const tweets = JSON.parse(stdout);
          resolve(Array.isArray(tweets) ? tweets.map(t => ({
            id: `brand-x-${t.id || Date.now()}`,
            source: 'brand-search:twitter',
            sourceUrl: t.url || '',
            title: (t.text || '').slice(0, 120),
            body: t.text || '',
            image: null,
            tags: ['brand-mention', 'twitter'],
            rank: 0,
            metrics: { likes: t.likes || 0, retweets: t.retweets || 0 },
            author: t.author || '',
            crawledAt: new Date().toISOString(),
            publishedAt: t.created_at || null,
            language: 'en',
          })) : []);
        } catch { resolve([]); }
      }
    );
  });
}

async function crawl() {
  const searches = [];

  // Brand name searches
  for (const term of brandSearch.terms || []) {
    searches.push(searchGoogleNews(term, 'brand'));
  }
  // Competitor searches
  for (const term of brandSearch.competitorTerms || []) {
    searches.push(searchGoogleNews(term, 'competitor'));
  }
  // Industry searches
  for (const term of brandSearch.industryTerms || []) {
    searches.push(searchGoogleNews(term, 'industry'));
  }
  // Twitter brand mention (best-effort)
  for (const term of (brandSearch.terms || []).slice(0, 2)) {
    searches.push(searchBnbotTwitter(term));
  }

  // Stagger slightly to avoid rate limiting
  const results = [];
  for (let i = 0; i < searches.length; i += 3) {
    const batch = searches.slice(i, i + 3);
    const batchResults = await Promise.all(batch);
    results.push(...batchResults.flat());
    if (i + 3 < searches.length) await new Promise(r => setTimeout(r, 500));
  }

  return results;
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-brand] Fetched ${results.length} mentions\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-brand] Error: ${err.message}\n`);
    process.exit(1);
  });
