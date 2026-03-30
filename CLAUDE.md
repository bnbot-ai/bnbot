# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

bnbot-editor is a Claude Code Skill that discovers trending topics from multiple sources and generates tweet drafts matching the user's voice. It pairs with [bnbot-cli](https://github.com/bnbot-ai/bnbot-cli) for publishing to Twitter/X.

## Commands

```bash
npm run crawl          # Run all crawlers (HN + RSS), output JSON to stdout
npm run crawl:hn       # Hacker News only
npm run crawl:rss      # RSS feeds only
```

All scripts output JSON to stdout and log to stderr. No API keys required.

## Architecture

```
SKILL.md (Claude reads this to know what to do)
    │
    ├── scripts/crawl-all.js    ← orchestrator, runs crawlers in parallel via child_process
    │       ├── crawl-hn.js     ← HN Firebase API, fetches og:image from article URLs
    │       └── crawl-rss.js    ← rss-parser, extracts images from media tags
    │
    ├── config/sources.json     ← RSS feed URLs and crawler settings
    └── references/persona.md   ← user's brand voice, domains, anti-AI rules
```

**Data flow**: Crawl scripts → unified JSON (`RawContent[]`) → Claude filters/ranks → generates tweet drafts → user confirms → bnbot-cli posts.

Claude itself does the filtering, scoring, and content generation — no separate LLM API calls. The scripts handle deterministic data collection only.

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
