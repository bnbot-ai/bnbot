#!/usr/bin/env node

/**
 * Scrape tweets from a Twitter account for style analysis
 * Uses bnbot-cli if available, degrades gracefully if not
 * Usage: node scripts/scrape-style.js --username Apple --limit 20
 * Output: JSON object with tweets array to stdout
 */

import { execFile } from 'child_process';

const username = process.argv.find((_, i, a) => a[i - 1] === '--username');
const limit = process.argv.find((_, i, a) => a[i - 1] === '--limit') || '20';

if (!username) {
  process.stderr.write('Usage: node scrape-style.js --username <handle> --limit 20\n');
  process.exit(1);
}

function tryBnbot() {
  return new Promise((resolve) => {
    execFile('bnbot', [
      'scrape', 'user-tweets',
      username,
      '-l', limit,
    ], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        process.stderr.write(`[scrape-style] bnbot not available: ${err.message}\n`);
        resolve(null);
        return;
      }
      try {
        const tweets = JSON.parse(stdout);
        if (Array.isArray(tweets) && tweets.length > 0) {
          resolve(tweets);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
  });
}

async function main() {
  const tweets = await tryBnbot();

  if (tweets) {
    console.log(JSON.stringify({
      username,
      tweetCount: tweets.length,
      scrapedAt: new Date().toISOString(),
      tweets: tweets.map(t => ({
        text: t.text || t.full_text || '',
        likes: t.like_count || t.likes || 0,
        retweets: t.retweet_count || t.retweets || 0,
        replies: t.reply_count || 0,
        views: parseInt(t.view_count || t.views || '0'),
        hasMedia: !!(t.media?.length || t.has_media),
        isThread: !!(t.is_thread || t.thread_id),
        isReply: !!(t.is_reply || t.in_reply_to),
        createdAt: t.created_at || null,
      })),
    }, null, 2));
  } else {
    // Graceful degradation
    console.log(JSON.stringify({
      username,
      error: 'bnbot_not_available',
      message: 'Cannot scrape tweets. Start bnbot (bnbot serve) or paste sample tweets manually.',
    }, null, 2));
  }
}

main();
