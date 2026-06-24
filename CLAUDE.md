# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Crow's Nest is an Eleventy static site that publishes one permanent archive page per day. A daily pipeline reads RSS headlines from Portuguese press outlets, summarises them with DeepSeek, and builds the site. It uses only RSS metadata (`title`, `link`, short description) - it never scrapes article bodies. The site is Portuguese-only: sources are Portuguese press, all generated content and UI are European Portuguese (pt-PT).

## Commands

```bash
npm ci                 # install (use ci, lockfile is committed)
npm run fetch          # stage 1: RSS -> data/latest-feed.json (+ data/feed-health.json)
npm run summarise      # stage 2: latest-feed.json -> src/_data/digest/YYYY-MM-DD.json (needs DEEPSEEK_API_KEY)
npm run resolve        # stage 3: normalise topics -> src/_data/topics.json, rewrite digest topics (needs key only if unresolved digests exist)
npm run build          # stage 4: eleventy src/ -> _site/
npm run daily          # fetch && summarise && resolve && build
# DEEPSEEK_API_KEY: put it in .env (loaded via node --env-file-if-exists) or export it; missing key exits 1
```

There is no test suite, linter, or watch script. To preview without the LLM, run `npm run build` against whatever digest JSONs already exist in `src/_data/digest/`. `npm run resolve` is a no-op (exits 0 without needing the key) when every digest already has resolved topics.

## Pipeline architecture

Four sequential stages, each a standalone Node script, connected by JSON files on disk:

1. **`scripts/fetch.mjs`** - reads `feeds.json`, fetches each outlet (primary `url`, falling back to `fallback` Google News RSS if primary errors or returns zero items), strips HTML, keeps top 20 items per feed. Writes `data/latest-feed.json` (gitignored, intermediate) and `data/feed-health.json` (gitignored diagnostic of per-outlet primary/fallback/skipped status).
2. **`scripts/summarise.mjs`** - sends `latest-feed.json` to DeepSeek (`deepseek-v4-flash`, `response_format: json_object`), retries once on parse/shape failure, normalises, writes `src/_data/digest/YYYY-MM-DD.json` (committed - the durable archive). Adds `meta.sources` (outlet name -> "primary"|"fallback") so the UI can badge fallback-sourced summaries. Date stamped `Europe/Lisbon`.
3. **`scripts/resolve-topics.mjs`** - the keystone for trends. Finds digests whose `topics` are still bare strings, and for each calls DeepSeek (temperature 0) to map them onto the canonical registry `src/_data/topics.json`, allowing synonyms/abbreviations/language variants. Rewrites that digest's `topics` from `["string"]` to `[{id, label}]` and appends the date to each topic's `occurrences`. Idempotent: already-resolved digests are skipped, so re-running never double-counts. Processes digests chronologically so `firstSeen`/`lastSeen` are correct.
4. **`eleventy`** - reads committed digest JSONs + `topics.json` and renders the site.

The digest shape is a single group: `{ date, meta, press: { topics, outlets } }`. The `press` key is the lone group, hardcoded in `summarise.mjs` (`validateShape`, prompt), `resolve-topics.mjs` (`GROUPS = ["press"]`), the data loaders, and templates. The codebase keeps the named-group structure (rather than flattening) so a second group could be reintroduced by adding it to `feeds.json`, the summarise prompt + `validateShape`, `GROUPS`, and the templates. Each topic still carries a `group` field for that reason.

Topics are **atomic**: one concept each, never two themes joined by "e". The summarise prompt enforces this on generation, and the resolver enforces it again by splitting any compound raw topic into multiple canonical topics (one raw topic string can map to several `{id,label}` entries). Labels are minimal (one or two words), Title Case, European Portuguese.

**`src/_data/topics.json` is the canonical topic registry** - committed and intentionally hand-editable. Each topic has a stable `id` (slug, accents stripped), `label`, `group`, `aliases` (accumulated label variants), `occurrences` (sorted dates), `articles` (`{date, title, link, outlet}` for the headlines that drove the topic, deduped by link, newest first), `firstSeen`, `lastSeen`. When the resolver mis-merges or mis-splits a topic, fix it here by hand; aliases make the fix stick. Everything derived (trends, topic pages, heatmap, search) reads from this file.

Article links flow: `summarise.mjs` asks the model to attach, per topic, the source item links; those links are validated against the actual fetched items (`buildLinkIndex`) so titles/outlets come from the feed, never the model, and hallucinated links are dropped. `resolve-topics.mjs` threads each topic's articles onto its canonical entry (purged/re-added per date alongside occurrences). The topic page renders them under "Notícias".

The DeepSeek summarise prompt enforces: European Portuguese only, one-sentence outlet summaries, atomic single-concept topics (max 8), "use only provided items, never invent news." Content/language/atomicity rules live in that prompt string and the resolver prompt, not in templates.

## Eleventy specifics

- Config (`eleventy.config.js`): input `src/`, output `_site/`, includes `src/_includes/`.
- Global data loaders in `src/_data/` are `.cjs` (CommonJS) even though the package is `"type": "module"` - keep that extension. `.json` data files (`topics.json`) load as-is.
- `digests.cjs` loads every `digest/*.json` newest-first. `trends.cjs` (top/trending/active topics, momentum = last-7d count minus prior-7d), `onThisDay.cjs` (prior-year digests sharing today's month-day), `calendar.cjs` (heatmap cells, Monday-aligned weeks), `topicPages.cjs` (per-topic data + cumulative-occurrence sparkline points), `searchIndex.cjs` (flat client search index) all derive from the committed digests/registry at build time - no extra API cost.
- Pages: `index.njk` (today + trending + on-this-day + heatmap), `day.njk` (paginates `digests` -> `/YYYY-MM-DD/`), `topic.njk` (paginates `topicPages` -> `/topic/<id>/`), `topics.njk`, `archive.njk`, `search.njk` (client-side fetch of `/search-index.json`), `search-index.njk` (emits that JSON). `src/_includes/group.njk` is the shared macro rendering a group's topic chips + outlet summaries + fallback badges.
- `outletLinks.cjs` derives each outlet homepage from its feed `url` origin. Outlet names must match exactly between `feeds.json` and digest JSON for links/badges to resolve.
- Date math in data loaders uses `Date.UTC` on `YYYY-MM-DD` strings against an `Europe/Lisbon` "today"; do not introduce local-timezone `Date` parsing or the heatmap/trends windows drift.

## Deployment

`.github/workflows/daily.yml` runs at 08:00 UTC daily (or via workflow_dispatch): fetch, summarise, **commit new `src/_data/digest/*.json` back to the repo**, build, deploy `_site` to GitHub Pages. Requires repo secret `DEEPSEEK_API_KEY` and Pages set to the GitHub Actions source. The commit step is how the archive grows - digest files are intended to be version-controlled.
