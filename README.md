# Crow's Nest

Crow's Nest is a daily news digest built with [Eleventy](https://www.11ty.dev/). Every day it reads RSS headlines from Portuguese press outlets, summarises them with DeepSeek, normalises the day's themes into a tracked set of topics, and publishes one permanent archive page per day. The site and all generated content are in European Portuguese.

It uses only RSS metadata (`title`, `link`, and a short feed description). It never scrapes full article bodies, and every outlet links back to its source.

## Features

- **Daily digest** of 15 Portuguese outlets, one permanent page per day (`/YYYY-MM-DD/`).
- **Atomic topic tracking** - each day's themes are normalised into a stable, hand-editable registry, so the same topic is one entity across time.
- **Topic pages** (`/topic/<id>/`) with a coverage sparkline and links to the source headlines.
- **Trends** - "trending this week" by week-over-week momentum, plus a calendar activity heatmap.
- **"On this day"** - resurfaces digests from prior years sharing today's date.
- **Client-side search** over every day's topics and summaries.
- **Source transparency** - outlets served from a fallback feed are badged; per-run feed health is recorded.

## Pipeline

Four stages, each a standalone Node script, connected by JSON files on disk:

1. `npm run fetch` - reads `feeds.json`, fetches each outlet (primary feed, falling back to Google News RSS), writes `data/latest-feed.json` and `data/feed-health.json`.
2. `npm run summarise` - sends the items to DeepSeek, writes `src/_data/digest/YYYY-MM-DD.json` (the durable, committed archive). Requires `DEEPSEEK_API_KEY`.
3. `npm run resolve` - normalises the day's free-text topics onto the canonical registry `src/_data/topics.json`, keeping topics atomic and Portuguese, and attaches the source article links.
4. `npm run build` - Eleventy renders `src/` into `_site/`.

`npm run daily` runs all four.

## Setup

1. Install dependencies:
   ```bash
   npm ci
   ```
2. Provide your DeepSeek key for local runs - either export it or put it in a `.env` file (loaded automatically via `node --env-file-if-exists`):
   ```bash
   echo "DEEPSEEK_API_KEY=your_key_here" > .env
   ```
3. Generate and build:
   ```bash
   npm run daily
   ```

Preview without re-running the LLM (uses whatever digests already exist):

```bash
npx @11ty/eleventy --serve
```

## GitHub Actions and Pages

The workflow in `.github/workflows/daily.yml` runs daily and can be triggered manually via **workflow_dispatch**. It fetches feeds, summarises, resolves topics, commits new digest data back to the repo, builds, and deploys `_site` to GitHub Pages.

Required repository setup:

1. Add the repository secret `DEEPSEEK_API_KEY`.
2. Enable GitHub Pages with the GitHub Actions source.
3. Keep workflow write permissions for contents/pages/id-token (already declared in the workflow).

## Editing topics

`src/_data/topics.json` is committed and meant to be hand-edited. When the resolver mis-merges or mis-splits a topic, fix the label, `id`, or `aliases` there; accumulated aliases make the correction stick on future runs.
