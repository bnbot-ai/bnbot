#!/usr/bin/env node

/**
 * Check GitHub repos for new releases and significant commits
 * Usage: node scripts/crawl-github-releases.js --profile path/to/profile.json
 * Output: JSON array of RawContent to stdout
 */

import { readFileSync } from 'fs';
import proxyFetch from './lib/fetch.js';

const profilePath = process.argv.find((_, i, a) => a[i - 1] === '--profile');
if (!profilePath) {
  process.stderr.write('Usage: node crawl-github-releases.js --profile <path>\n');
  process.exit(1);
}

const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
const githubConfig = profile.brand?.github;
if (!githubConfig?.repos?.length) {
  console.log('[]');
  process.exit(0);
}

const lastChecked = githubConfig.lastChecked || new Date(Date.now() - 7 * 86400000).toISOString();

async function fetchGH(path) {
  const res = await proxyFetch(`https://api.github.com${path}`, {
    headers: {
      'User-Agent': 'bnbot-editor/0.1',
      'Accept': 'application/vnd.github.v3+json',
      ...(process.env.GITHUB_TOKEN ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
  return res.json();
}

async function checkRepo(repo) {
  const results = [];
  const { owner, repo: repoName, label, watchReleases, watchCommits, commitBranch, minCommitCount, tweetStyle } = repo;
  const fullName = `${owner}/${repoName}`;

  // Check releases
  if (watchReleases) {
    try {
      const releases = await fetchGH(`/repos/${fullName}/releases?per_page=5`);
      const newReleases = releases.filter(r => new Date(r.published_at) > new Date(lastChecked));

      for (const release of newReleases) {
        results.push({
          id: `gh-release-${fullName}-${release.tag_name}`,
          source: 'github-release',
          sourceUrl: release.html_url,
          title: `${label || fullName} ${release.tag_name}: ${release.name || 'New Release'}`,
          body: (release.body || '').slice(0, 1000),
          image: `https://opengraph.githubassets.com/1/${fullName}`,
          tags: ['github', 'release', 'product-update'],
          rank: 0,
          metrics: {
            assets: release.assets?.length || 0,
          },
          author: release.author?.login || '',
          crawledAt: new Date().toISOString(),
          publishedAt: release.published_at,
          language: 'en',
          meta: { tweetStyle, repoFullName: fullName, tagName: release.tag_name },
        });
      }
    } catch (err) {
      process.stderr.write(`[crawl-gh-release] ${fullName} releases: ${err.message}\n`);
    }
  }

  // Check commits
  if (watchCommits) {
    try {
      const branch = commitBranch || 'main';
      const commits = await fetchGH(`/repos/${fullName}/commits?sha=${branch}&since=${lastChecked}&per_page=30`);
      const threshold = minCommitCount || 3;

      if (commits.length >= threshold) {
        const commitSummary = commits.slice(0, 10).map(c =>
          `- ${c.commit.message.split('\n')[0]}`
        ).join('\n');

        results.push({
          id: `gh-commits-${fullName}-${Date.now()}`,
          source: 'github-commits',
          sourceUrl: `https://github.com/${fullName}/commits/${branch}`,
          title: `${label || fullName}: ${commits.length} new commits on ${branch}`,
          body: commitSummary,
          image: `https://opengraph.githubassets.com/1/${fullName}`,
          tags: ['github', 'commits', 'product-update'],
          rank: 0,
          metrics: {
            commitCount: commits.length,
          },
          author: commits[0]?.author?.login || '',
          crawledAt: new Date().toISOString(),
          publishedAt: commits[0]?.commit?.author?.date || null,
          language: 'en',
          meta: { tweetStyle, repoFullName: fullName, branch },
        });
      }
    } catch (err) {
      process.stderr.write(`[crawl-gh-release] ${fullName} commits: ${err.message}\n`);
    }
  }

  return results;
}

async function crawl() {
  const results = (await Promise.all(githubConfig.repos.map(checkRepo))).flat();
  results.forEach((item, i) => item.rank = i + 1);
  return results;
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-gh-release] Fetched ${results.length} updates from ${githubConfig.repos.length} repos\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-gh-release] Error: ${err.message}\n`);
    process.exit(1);
  });
