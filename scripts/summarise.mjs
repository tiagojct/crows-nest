import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const INPUT_PATH = path.join(ROOT_DIR, "data", "latest-feed.json");
const OUTPUT_DIR = path.join(ROOT_DIR, "src", "_data", "digest");
const API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash";
const TIMEZONE = "Europe/Lisbon";

function lisbonDateStamp() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

const MAX_ARTICLES_PER_TOPIC = 12;

// link -> { title, outlet } over every fetched item, so the model's topic->link
// choices can be validated and enriched against the authoritative item data
// (titles/outlets come from the feed, never from the model).
function buildLinkIndex(input) {
  const linkIndex = {};
  for (const outlet of input?.groups?.press ?? []) {
    for (const item of outlet?.items ?? []) {
      if (item?.link && !linkIndex[item.link]) {
        linkIndex[item.link] = { title: String(item.title ?? "").trim(), outlet: outlet.name };
      }
    }
  }
  return linkIndex;
}

function normalizeGroup(group, linkIndex) {
  const rawTopics = Array.isArray(group?.topics) ? group.topics.slice(0, 8) : [];
  const topics = rawTopics
    .map((topic) => {
      const label = String(topic?.label ?? topic ?? "").trim();
      const links = Array.isArray(topic?.links) ? topic.links : [];
      const seen = new Set();
      const articles = [];
      for (const link of links) {
        const meta = linkIndex[link];
        if (meta && !seen.has(link)) {
          seen.add(link);
          articles.push({ title: meta.title, link, outlet: meta.outlet });
          if (articles.length >= MAX_ARTICLES_PER_TOPIC) break;
        }
      }
      return { label, articles };
    })
    .filter((topic) => topic.label);

  const outlets = Array.isArray(group?.outlets)
    ? group.outlets.map((outlet) => ({
        name: String(outlet?.name ?? "").trim(),
        summary: String(outlet?.summary ?? "").trim()
      }))
    : [];

  return {
    topics,
    outlets: outlets.filter((outlet) => outlet.name && outlet.summary)
  };
}

function buildMeta(input) {
  const sources = {};
  for (const outlets of Object.values(input.groups ?? {})) {
    if (!Array.isArray(outlets)) continue;
    for (const outlet of outlets) {
      if (outlet?.name) {
        sources[outlet.name] = outlet.source ?? "primary";
      }
    }
  }
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sources
  };
}

function validateShape(parsed) {
  return (
    parsed &&
    typeof parsed === "object" &&
    parsed.press &&
    Array.isArray(parsed.press.topics) &&
    Array.isArray(parsed.press.outlets)
  );
}

async function callDeepSeek(apiKey, payload) {
  const systemPrompt = [
    "You are summarising daily RSS headlines from Portuguese press outlets.",
    "The input lists outlets, each with news items that have a title, link, and short description.",
    "Use only the provided items. Never invent or infer news, links, or text not present in the input.",
    "Return strict JSON only, with no markdown fences, no commentary, and no preamble.",
    "Output format must be exactly:",
    '{"press":{"topics":[{"label":"string","links":["string"]}],"outlets":[{"name":"string","summary":"string"}]}}',
    "All text must be written in European Portuguese (never Brazilian variants).",
    "If a headline is in another language, still write the topic label in Portuguese.",
    "Each topic label MUST be atomic: a single concept, one or two words.",
    'NEVER combine concepts. Do not use "e", "and", "&", "/", or commas to join themes in a label.',
    'Split compound themes: "Clima e incêndios" must become two topics, "Clima" and "Incêndios".',
    "For each topic, links must be the exact item links (copied verbatim from the input) of the headlines about that topic.",
    "Only use links that appear in the input. Max 8 topics.",
    "Each outlet summary must be exactly one sentence."
  ].join(" ");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify(payload)
        }
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
  return content.trim();
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("[summarise] missing DEEPSEEK_API_KEY");
    process.exit(1);
  }

  const inputRaw = await fs.readFile(INPUT_PATH, "utf8");
  const input = JSON.parse(inputRaw);

  const linkIndex = buildLinkIndex(input);
  const llmPayload = {
    date: input.date ?? lisbonDateStamp(),
    groups: input.groups ?? { press: [] }
  };

  let parsed = null;
  let lastParseError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const content = await callDeepSeek(apiKey, llmPayload);
    try {
      parsed = JSON.parse(content);
      if (!validateShape(parsed)) {
        throw new Error("JSON parsed but has invalid shape");
      }
      break;
    } catch (error) {
      lastParseError = error;
      console.warn(`[summarise] parse failed on attempt ${attempt}: ${error.message}`);
    }
  }

  if (!parsed) {
    throw new Error(`failed to parse model JSON output after retry: ${lastParseError?.message ?? "unknown error"}`);
  }

  const date = input.date ?? lisbonDateStamp();
  const digest = {
    date,
    meta: buildMeta(input),
    press: normalizeGroup(parsed.press, linkIndex)
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, `${date}.json`);
  await fs.writeFile(outPath, `${JSON.stringify(digest, null, 2)}\n`, "utf8");
  console.log(`[summarise] wrote ${outPath}`);
}

main().catch((error) => {
  console.error(`[summarise] failed: ${error.message}`);
  process.exit(1);
});
