#!/usr/bin/env node

/**
 * Crawl Hugging Face daily papers (trending AI research)
 * Uses the public API (no key needed)
 * Usage: node scripts/crawl-huggingface.js
 * Output: JSON array of RawContent to stdout
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import proxyFetch from './lib/fetch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '../config/sources.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const TOP_N = config.huggingface?.topN || 10;

async function crawl() {
  // HuggingFace daily papers API — no date param returns latest papers
  const url = 'https://huggingface.co/api/daily_papers';

  const res = await proxyFetch(url, {
    headers: { 'User-Agent': 'bnbot-editor/0.1' },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`HuggingFace API ${res.status}`);
  return formatPapers(await res.json());
}

function formatPapers(papers) {
  return papers
    .sort((a, b) => (b.paper?.upvotes || 0) - (a.paper?.upvotes || 0))
    .slice(0, TOP_N)
    .map((item, rank) => {
      const paper = item.paper || item;
      const paperId = paper.id || paper.paperId || '';
      const title = paper.title || '';
      const summary = paper.summary || paper.abstract || '';
      const authors = paper.authors?.map(a => a.name || a.user?.fullname || '').filter(Boolean) || [];
      const upvotes = paper.upvotes || item.numUpvotes || 0;
      const comments = paper.numComments || item.numComments || 0;

      // HuggingFace paper thumbnail
      const thumbnail = paper.thumbnailUrl
        || (paperId ? `https://huggingface.co/papers/${paperId}/thumbnail` : null);

      return {
        id: `hf-${paperId}`,
        source: 'huggingface-papers',
        sourceUrl: `https://huggingface.co/papers/${paperId}`,
        title: title,
        body: [
          summary.slice(0, 400),
          authors.length ? `Authors: ${authors.slice(0, 3).join(', ')}${authors.length > 3 ? ' et al.' : ''}` : '',
        ].filter(Boolean).join('\n'),
        image: thumbnail,
        tags: ['ai', 'research', 'paper', 'huggingface'],
        rank: rank + 1,
        metrics: {
          upvotes,
          comments,
        },
        author: authors[0] || '',
        crawledAt: new Date().toISOString(),
        publishedAt: paper.publishedAt || item.publishedAt || null,
        language: 'en',
      };
    });
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-hf] Fetched ${results.length} papers\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-hf] Error: ${err.message}\n`);
    process.exit(1);
  });
