import fs from "node:fs/promises";
import path from "node:path";

// Resolves the free-text topic strings produced by summarise.mjs into stable
// canonical topics tracked across days in src/_data/topics.json. After this
// stage runs, each digest's topics are objects { id, label } instead of bare
// strings, which is what makes trends, topic pages and the year-ago feature
// possible. Topics are kept atomic (one concept each): a compound raw topic may
// resolve to SEVERAL canonical topics. The registry is committed and
// hand-editable: when the resolver mis-merges or mis-splits, fix topics.json by
// hand and aliases accumulate.

const ROOT_DIR = process.cwd();
const DIGEST_DIR = path.join(ROOT_DIR, "src", "_data", "digest");
const TOPICS_PATH = path.join(ROOT_DIR, "src", "_data", "topics.json");
const API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash";
const GROUPS = ["press"];

function slugify(label) {
  const slug = String(label)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "topic";
}

function uniqueSlug(base, taken) {
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

// A topic is unresolved while it is a bare string or an object that has no
// canonical `id` yet (summarise emits { label, articles }). Once resolved it is
// { id, label }, so re-runs skip it.
function isUnresolved(topics) {
  return (
    Array.isArray(topics) &&
    topics.some((t) => typeof t === "string" || (t && typeof t === "object" && !t.id))
  );
}

async function loadTopics() {
  try {
    const raw = await fs.readFile(TOPICS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.topics) ? parsed.topics : [];
  } catch {
    return [];
  }
}

async function listUnresolvedDigests() {
  let files;
  try {
    files = await fs.readdir(DIGEST_DIR);
  } catch {
    return [];
  }
  const dates = files
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace(/\.json$/, ""))
    .sort(); // ascending so firstSeen is computed in chronological order

  const out = [];
  for (const date of dates) {
    const fullPath = path.join(DIGEST_DIR, `${date}.json`);
    const digest = JSON.parse(await fs.readFile(fullPath, "utf8"));
    const unresolved = GROUPS.some((g) => isUnresolved(digest?.[g]?.topics));
    if (unresolved) {
      out.push({ date, fullPath, digest });
    }
  }
  return out;
}

async function callResolver(apiKey, group, rawTopics, candidates) {
  const systemPrompt = [
    "You normalise daily news topic labels against a canonical registry, keeping topics atomic.",
    "You receive the existing canonical topics (id, label, aliases) and today's raw topic strings.",
    "For each raw string, output one or more atomic canonical topics (a single concept each).",
    'Split any compound raw topic: "Clima e incêndios" becomes two topics, "Clima" and "Incêndios".',
    "Map each atomic topic to the SAME existing canonical id when it refers to the same ongoing topic,",
    "allowing synonyms, abbreviations, and singular/plural variants. Otherwise set id to null.",
    "Every canonical label MUST be European Portuguese; translate any non-Portuguese label",
    "(for example \"Climate and Energy\" becomes the two topics \"Clima\" and \"Energia\").",
    "Split aggressively: any label containing \"e\", \"and\", \"&\", \"/\", or a comma, or expressing",
    "more than one concept, must become several canonical topics, each a single concept of one or two words.",
    "Labels must be Title Case and minimal.",
    "Return strict JSON only, no markdown fences, no commentary:",
    '{"mappings":[{"raw":"string","topics":[{"id":"existing-id-or-null","label":"Canonical Label"}]}]}',
    "Include exactly one mapping per raw string, preserving the raw text verbatim."
  ].join(" ");

  const payload = {
    group,
    candidates: candidates.map((t) => ({ id: t.id, label: t.label, aliases: t.aliases ?? [] })),
    topics: rawTopics
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
  }

  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("DeepSeek response missing choices[0].message.content");
  }

  const parsed = JSON.parse(content);
  if (!parsed || !Array.isArray(parsed.mappings)) {
    throw new Error("resolver output missing mappings array");
  }
  return parsed.mappings;
}

async function resolveMappings(apiKey, group, rawTopics, candidates) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await callResolver(apiKey, group, rawTopics, candidates);
    } catch (error) {
      lastError = error;
      console.warn(`[resolve] ${group} attempt ${attempt} failed: ${error.message}`);
    }
  }
  throw new Error(`resolver failed after retry: ${lastError?.message ?? "unknown"}`);
}

function addOccurrence(topic, date) {
  if (!topic.occurrences.includes(date)) {
    topic.occurrences.push(date);
    topic.occurrences.sort();
  }
  topic.firstSeen = topic.occurrences[0];
  topic.lastSeen = topic.occurrences[topic.occurrences.length - 1];
}

function addArticles(topic, date, articles) {
  if (!Array.isArray(topic.articles)) topic.articles = [];
  const have = new Set(topic.articles.map((a) => a.link));
  for (const article of articles) {
    if (article?.link && !have.has(article.link)) {
      have.add(article.link);
      topic.articles.push({
        date,
        title: String(article.title ?? "").trim(),
        link: article.link,
        outlet: article.outlet ?? ""
      });
    }
  }
  topic.articles.sort((a, b) => b.date.localeCompare(a.date));
}

async function main() {
  const pending = await listUnresolvedDigests();
  if (pending.length === 0) {
    console.log("[resolve] no unresolved digests, nothing to do");
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("[resolve] missing DEEPSEEK_API_KEY");
    process.exit(1);
  }

  const topics = await loadTopics();
  const byId = new Map(topics.map((t) => [t.id, t]));
  const takenIds = new Set(byId.keys());

  for (const { date, fullPath, digest } of pending) {
    // Purge this date from every topic first, so re-resolving a re-summarised
    // day cannot leave orphan occurrences behind. Topics emptied by the purge
    // are dropped at the end.
    for (const topic of topics) {
      const idx = topic.occurrences.indexOf(date);
      if (idx !== -1) {
        topic.occurrences.splice(idx, 1);
        topic.firstSeen = topic.occurrences[0] ?? null;
        topic.lastSeen = topic.occurrences[topic.occurrences.length - 1] ?? null;
      }
      if (Array.isArray(topic.articles)) {
        topic.articles = topic.articles.filter((a) => a.date !== date);
      }
    }

    for (const group of GROUPS) {
      const rawTopics = digest?.[group]?.topics;
      if (!isUnresolved(rawTopics)) {
        continue; // already resolved or absent
      }
      // summarise emits topics as { label, articles }; older digests may have
      // bare strings. Normalise to entries and key articles by label.
      const rawEntries = rawTopics
        .map((t) =>
          typeof t === "string"
            ? { label: t.trim(), articles: [] }
            : { label: String(t?.label ?? "").trim(), articles: Array.isArray(t?.articles) ? t.articles : [] }
        )
        .filter((e) => e.label);
      if (rawEntries.length === 0) {
        digest[group].topics = [];
        continue;
      }
      const rawStrings = rawEntries.map((e) => e.label);
      const articlesByLabel = new Map(rawEntries.map((e) => [e.label, e.articles]));

      const candidates = topics.filter((t) => t.group === group);
      const mappings = await resolveMappings(apiKey, group, rawStrings, candidates);
      const byRaw = new Map(mappings.map((m) => [m.raw, m]));

      const resolved = [];
      const seenIds = new Set();
      for (const raw of rawStrings) {
        const mapping = byRaw.get(raw);
        const canonicals = Array.isArray(mapping?.topics) && mapping.topics.length
          ? mapping.topics
          : [{ id: null, label: raw }];
        const rawArticles = articlesByLabel.get(raw) ?? [];

        for (const canonical of canonicals) {
          let topic = canonical.id ? byId.get(canonical.id) : null;

          if (topic && topic.group === group) {
            const label = canonical.label;
            if (label && label !== topic.label && !topic.aliases.includes(label)) {
              topic.aliases.push(label);
            }
          } else {
            const label = (canonical.label || raw).trim();
            const id = uniqueSlug(slugify(label), takenIds);
            takenIds.add(id);
            topic = {
              id,
              label,
              group,
              aliases: [],
              occurrences: [],
              articles: [],
              firstSeen: date,
              lastSeen: date
            };
            topics.push(topic);
            byId.set(id, topic);
          }

          addOccurrence(topic, date);
          addArticles(topic, date, rawArticles);
          if (!seenIds.has(topic.id)) {
            seenIds.add(topic.id);
            resolved.push({ id: topic.id, label: topic.label });
          }
        }
      }

      digest[group].topics = resolved;
    }

    await fs.writeFile(fullPath, `${JSON.stringify(digest, null, 2)}\n`, "utf8");
    console.log(`[resolve] resolved topics for ${date}`);
  }

  const kept = topics.filter((t) => t.occurrences.length > 0);
  kept.sort((a, b) => a.id.localeCompare(b.id));
  await fs.writeFile(TOPICS_PATH, `${JSON.stringify({ topics: kept }, null, 2)}\n`, "utf8");
  console.log(`[resolve] wrote ${TOPICS_PATH} (${kept.length} topics)`);
}

main().catch((error) => {
  console.error(`[resolve] failed: ${error.message}`);
  process.exit(1);
});
