# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

bnbot-editor is a Claude Code Skill that discovers trending topics from multiple sources and generates tweet drafts matching the user's voice. It pairs with [bnbot-cli](https://github.com/bnbot-ai/bnbot-cli) for publishing to Twitter/X.

## Prerequisites

```bash
npm install -g bnbot-cli            # Twitter/X scraping & publishing
npm install -g @jackwener/opencli   # TikTok, YouTube, Instagram data
```

Both CLIs connect through BNBot Chrome Extension (which has a built-in opencli bridge).

## Commands

```bash
npm run crawl          # Run all 15+ crawlers, output JSON to stdout
npm run crawl:hn       # Hacker News only
npm run crawl:rss      # RSS feeds only
npm run crawl:tiktok   # TikTok trending (requires opencli)
npm run crawl:youtube  # YouTube trending (opencli, RSS fallback)
```

All scripts output JSON to stdout and log to stderr.

## Architecture

```
SKILL.md (Claude reads this to know what to do)
    │
    ├── scripts/crawl-all.js    ← orchestrator, runs 15+ crawlers in parallel
    │       ├── crawl-hn.js     ← HN Firebase API
    │       ├── crawl-rss.js    ← RSS feeds via rss-parser
    │       ├── crawl-tiktok.js ← opencli → ScrapeCreators fallback
    │       ├── crawl-youtube.js← opencli → RSS channel feeds fallback
    │       ├── crawl-instagram.js ← opencli → ScrapeCreators fallback
    │       ├── crawl-x-kol.js  ← BNBot API (AI/crypto KOL tweets)
    │       └── ... (github, reddit, producthunt, huggingface, devto, v2ex, bilibili, weibo)
    │
    ├── scripts/lib/opencli.js  ← opencli CLI wrapper (required for TikTok/YouTube/Instagram)
    ├── config/sources.json     ← RSS feed URLs and crawler settings
    └── references/persona.md   ← universal anti-AI writing rules
```

**Data flow**: Crawl scripts → unified JSON (`RawContent[]`) → Claude filters/ranks → generates tweet drafts → user confirms → bnbot-cli posts.

Claude itself does the filtering, scoring, and content generation — no separate LLM API calls. The scripts handle deterministic data collection only.

**External dependencies**: opencli provides TikTok/YouTube/Instagram data through BNBot Extension's built-in browser bridge — one extension handles both bnbot-cli and opencli connections.

## Unified Content Schema

Every crawler outputs the same `RawContent` shape:

```
id, source, sourceUrl, title, body, image, tags, rank, metrics {upvotes, comments}, crawledAt, publishedAt, language
```

## Adding a New Crawler

1. Create `scripts/crawl-<source>.js` outputting `RawContent[]` JSON to stdout
2. Add its path to the `crawlers` array in `crawl-all.js`
3. Deduplication in `crawl-all.js` uses normalized title (lowercase, alphanumeric, first 60 chars)

## Key Design Decisions

- **ES Modules** throughout (`"type": "module"` in package.json), requires Node >= 18
- **No database** — crawl results are ephemeral, piped through stdout
- **Graceful degradation** — if one crawler fails, others still return results
- **Image extraction is best-effort** — og:image fetch has 5s timeout, returns null on failure
- **RSS maxAge is 24h** — only recent articles pass the filter
