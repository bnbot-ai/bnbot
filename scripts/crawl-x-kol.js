#!/usr/bin/env node

/**
 * Crawl KOL tweets from BNBot API (last 24h)
 * Usage: node scripts/crawl-kol.js ai
 *        node scripts/crawl-kol.js crypto
 * Output: JSON array of RawContent to stdout
 */

import proxyFetch from './lib/fetch.js';

const kolType = process.argv[2];
if (!kolType || !['ai', 'crypto'].includes(kolType)) {
  process.stderr.write('Usage: node crawl-kol.js <ai|crypto>\n');
  process.exit(1);
}

function detectLanguage(text) {
  const cjk = text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g);
  return (cjk && cjk.length > text.length * 0.1) ? 'zh' : 'en';
}

const res = await proxyFetch(
  `https://api.bnbot.ai/api/v1/ai/kol-recent-data?kol_type=${kolType}&for_ai=true&compressed=false`,
  { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000) }
);

if (!res.ok) {
  process.stderr.write(`[crawl-kol-${kolType}] HTTP ${res.status}\n`);
  process.exit(1);
}

const data = await res.json();
const results = (data.data || [])
  .filter(t => !t.is_retweet)
  .map((t, i) => ({
    id: `kol-${t.id_str}`,
    source: `kol:${kolType}`,
    sourceUrl: `https://x.com/${t.user?.username}/status/${t.id_str}`,
    title: t.text?.slice(0, 120) || '',
    body: t.text || '',
    image: t.media?.find(m => m.type === 'photo')?.url || null,
    tags: [kolType, 'kol', 'twitter', ...(t.is_quote ? ['quote-tweet'] : [])],
    rank: 0,
    metrics: {
      likes: t.like_count || 0,
      retweets: t.retweet_count || 0,
      replies: t.reply_count || 0,
      quotes: t.quote_count || 0,
      views: parseInt(t.view_count || '0'),
    },
    author: t.user?.name || t.user?.username || '',
    authorHandle: t.user?.username || '',
    authorAvatar: t.user?.avatar || null,
    authorVerified: t.user?.is_blue_verified || false,
    crawledAt: new Date().toISOString(),
    publishedAt: t.created_at ? new Date(t.created_at).toISOString() : null,
    language: detectLanguage(t.text || ''),
    quotedTweet: t.quoted_tweet ? {
      text: t.quoted_tweet.text?.slice(0, 200),
      author: t.quoted_tweet.user?.username,
    } : null,
  }));

// Sort by engagement
results.sort((a, b) => {
  const score = m => (m.views || 0) + (m.likes || 0) * 10 + (m.retweets || 0) * 20;
  return score(b.metrics) - score(a.metrics);
});
results.forEach((item, i) => item.rank = i + 1);

console.log(JSON.stringify(results, null, 2));
process.stderr.write(`[crawl-kol-${kolType}] Fetched ${results.length} tweets\n`);
