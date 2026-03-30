#!/usr/bin/env node

/**
 * Crawl GitHub trending repositories via GitHub API search
 * Usage: node scripts/crawl-github.js [--language javascript] [--since daily]
 * Output: JSON array of RawContent to stdout
 */

import proxyFetch from './lib/fetch.js';

const LANGUAGE = process.argv.find((_, i, a) => a[i - 1] === '--language') || '';
const TOP_N = 20;
const CONCURRENCY = 5;

function getDateRange() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0]; // yesterday
}

async function fetchJSON(url, headers = {}) {
  const res = await proxyFetch(url, {
    headers: {
      'User-Agent': 'bnbot-editor/0.1',
      'Accept': 'application/vnd.github.v3+json',
      ...(process.env.GITHUB_TOKEN ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {}),
      ...headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
  return res.json();
}

async function pMap(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map(fn)));
  }
  return results;
}

async function crawl() {
  // Two queries: 1) new repos gaining traction, 2) recently created repos exploding
  const since = getDateRange();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const langQuery = LANGUAGE ? ` language:${LANGUAGE}` : '';

  // New repos (created in last 30 days) with decent stars — these are the "interesting new projects"
  const newReposQuery = `created:>=${monthAgo}${langQuery} stars:>50`;
  const newReposUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(newReposQuery)}&sort=stars&order=desc&per_page=${TOP_N}`;

  // Recently active repos created in last year with growing interest
  const activeQuery = `created:>=${weekAgo}${langQuery} stars:>20`;
  const activeUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(activeQuery)}&sort=stars&order=desc&per_page=10`;

  const [newData, activeData] = await Promise.all([
    fetchJSON(newReposUrl),
    fetchJSON(activeUrl).catch(() => ({ items: [] })),
  ]);

  // Merge and deduplicate, preferring new repos
  const seen = new Set();
  const repos = [];
  for (const repo of [...(newData.items || []), ...(activeData.items || [])]) {
    if (seen.has(repo.full_name)) continue;
    seen.add(repo.full_name);
    repos.push(repo);
    if (repos.length >= TOP_N) break;
  }

  // Fetch topics for each repo (best-effort)
  const topicsData = await pMap(repos, async (repo) => {
    try {
      const detail = await fetchJSON(
        `https://api.github.com/repos/${repo.full_name}/topics`,
        { 'Accept': 'application/vnd.github.mercy-preview+json' }
      );
      return detail.names || [];
    } catch {
      return [];
    }
  }, CONCURRENCY);

  return repos.map((repo, i) => ({
    id: `github-${repo.full_name.replace('/', '-')}`,
    source: 'github-trending',
    sourceUrl: repo.html_url,
    title: `${repo.full_name}: ${repo.description || 'No description'}`,
    body: [
      repo.description || '',
      topicsData[i]?.length ? `Topics: ${topicsData[i].join(', ')}` : '',
      repo.language ? `Language: ${repo.language}` : '',
      `Created: ${repo.created_at?.split('T')[0] || 'unknown'}`,
    ].filter(Boolean).join('\n'),
    image: `https://opengraph.githubassets.com/1/${repo.full_name}`,
    tags: [
      'github',
      ...(repo.language ? [repo.language.toLowerCase()] : []),
      ...topicsData[i]?.slice(0, 5) || [],
    ],
    rank: i + 1,
    metrics: {
      totalStars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      watchers: repo.watchers_count || 0,
      openIssues: repo.open_issues_count || 0,
    },
    author: repo.owner?.login || '',
    crawledAt: new Date().toISOString(),
    publishedAt: repo.created_at || null,
    language: 'en',
  }));
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-github] Fetched ${results.length} trending repos\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-github] Error: ${err.message}\n`);
    process.exit(1);
  });
