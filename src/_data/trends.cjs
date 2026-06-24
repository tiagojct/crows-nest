const fs = require("node:fs");
const path = require("node:path");

const TIMEZONE = "Europe/Lisbon";

function lisbonToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function toUTC(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function diffDays(a, b) {
  return Math.round((toUTC(a) - toUTC(b)) / 86400000);
}

function loadTopics() {
  const topicsPath = path.join(process.cwd(), "src", "_data", "topics.json");
  if (!fs.existsSync(topicsPath)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(topicsPath, "utf8"));
  return Array.isArray(parsed?.topics) ? parsed.topics : [];
}

module.exports = function trendsData() {
  const topics = loadTopics();
  const today = lisbonToday();

  const enriched = topics.map((topic) => {
    const occ = Array.isArray(topic.occurrences) ? topic.occurrences : [];
    const count = occ.length;
    const recent = occ.filter((d) => {
      const delta = diffDays(today, d);
      return delta >= 0 && delta < 7;
    }).length;
    const prior = occ.filter((d) => {
      const delta = diffDays(today, d);
      return delta >= 7 && delta < 14;
    }).length;
    const daysSinceLast = topic.lastSeen ? diffDays(today, topic.lastSeen) : null;
    return {
      id: topic.id,
      label: topic.label,
      group: topic.group,
      count,
      recent,
      prior,
      momentum: recent - prior,
      firstSeen: topic.firstSeen,
      lastSeen: topic.lastSeen,
      daysSinceLast
    };
  });

  const top = [...enriched].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 12);

  const trending = [...enriched]
    .filter((t) => t.momentum > 0)
    .sort((a, b) => b.momentum - a.momentum || b.recent - a.recent)
    .slice(0, 8);

  const active = enriched
    .filter((t) => t.daysSinceLast !== null && t.daysSinceLast <= 1)
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    today,
    totalTopics: enriched.length,
    top,
    trending,
    active
  };
};
