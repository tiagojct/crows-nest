import fs from "node:fs/promises";
import path from "node:path";
import Parser from "rss-parser";

const ROOT_DIR = process.cwd();
const FEEDS_PATH = path.join(ROOT_DIR, "feeds.json");
const OUTPUT_PATH = path.join(ROOT_DIR, "data", "latest-feed.json");
const TIMEZONE = "Europe/Lisbon";

const parser = new Parser({
  timeout: 15000
});

function lisbonDateStamp() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function stripHtml(input) {
  return (input ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toDigestItem(item) {
  return {
    title: (item.title ?? "").trim(),
    link: (item.link ?? "").trim(),
    description: stripHtml(
      item.contentSnippet ?? item.summary ?? item.content ?? item.description ?? ""
    )
  };
}

function homepageFromFeedUrl(url) {
  return new URL(url).origin;
}

async function readFeed(url) {
  const parsed = await parser.parseURL(url);
  return (parsed.items ?? []).slice(0, 20).map(toDigestItem).filter((item) => item.title && item.link);
}

async function fetchOutlet(outlet) {
  let directItems = [];
  let directError = null;

  try {
    directItems = await readFeed(outlet.url);
  } catch (error) {
    directError = error;
  }

  if (directItems.length > 0) {
    console.log(`[fetch] ${outlet.name}: primary feed (${outlet.url})`);
    return {
      name: outlet.name,
      homepage: homepageFromFeedUrl(outlet.url),
      source: "primary",
      sourceUrl: outlet.url,
      items: directItems
    };
  }

  try {
    const fallbackItems = await readFeed(outlet.fallback);
    if (fallbackItems.length === 0) {
      throw new Error("fallback feed returned zero items");
    }
    console.log(`[fetch] ${outlet.name}: fallback feed (${outlet.fallback})`);
    return {
      name: outlet.name,
      homepage: homepageFromFeedUrl(outlet.url),
      source: "fallback",
      sourceUrl: outlet.fallback,
      items: fallbackItems
    };
  } catch (fallbackError) {
    if (directError) {
      console.warn(
        `[fetch] ${outlet.name}: skipped (primary error: ${directError.message}; fallback error: ${fallbackError.message})`
      );
    } else {
      console.warn(
        `[fetch] ${outlet.name}: skipped (primary returned zero items; fallback error: ${fallbackError.message})`
      );
    }
    return null;
  }
}

async function main() {
  const raw = await fs.readFile(FEEDS_PATH, "utf8");
  const feedConfig = JSON.parse(raw);
  const groups = {};
  const health = [];

  for (const [groupName, outlets] of Object.entries(feedConfig)) {
    groups[groupName] = [];
    for (const outlet of outlets) {
      try {
        const result = await fetchOutlet(outlet);
        if (result) {
          groups[groupName].push(result);
          health.push({ group: groupName, name: outlet.name, status: result.source, items: result.items.length });
        } else {
          health.push({ group: groupName, name: outlet.name, status: "skipped", items: 0 });
        }
      } catch (error) {
        console.warn(`[fetch] ${outlet.name}: skipped (${error.message})`);
        health.push({ group: groupName, name: outlet.name, status: "skipped", items: 0 });
      }
    }
  }

  const healthPath = path.join(ROOT_DIR, "data", "feed-health.json");
  await fs.mkdir(path.dirname(healthPath), { recursive: true });
  await fs.writeFile(
    healthPath,
    `${JSON.stringify({ date: lisbonDateStamp(), generatedAt: new Date().toISOString(), outlets: health }, null, 2)}\n`,
    "utf8"
  );
  const fallbacks = health.filter((h) => h.status === "fallback").length;
  const skipped = health.filter((h) => h.status === "skipped").length;
  console.log(`[fetch] feed health: ${health.length} outlets, ${fallbacks} fallback, ${skipped} skipped`);

  const payload = {
    date: lisbonDateStamp(),
    generatedAt: new Date().toISOString(),
    groups
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[fetch] wrote ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(`[fetch] failed: ${error.message}`);
  process.exit(1);
});
