const fs = require("node:fs");
const path = require("node:path");

function topicLabels(group) {
  const topics = Array.isArray(group?.topics) ? group.topics : [];
  return topics.map((t) => (typeof t === "string" ? t : t?.label)).filter(Boolean);
}

function outletText(group) {
  const outlets = Array.isArray(group?.outlets) ? group.outlets : [];
  return outlets.map((o) => o.summary).filter(Boolean).join(" ");
}

// Flat search index consumed client-side by /search/. One entry per day; the
// `text` field is a lowercased haystack of topics + summaries for substring match.
module.exports = function searchIndexData() {
  const digestDir = path.join(process.cwd(), "src", "_data", "digest");
  if (!fs.existsSync(digestDir)) {
    return [];
  }

  return fs
    .readdirSync(digestDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort((a, b) => b.localeCompare(a))
    .map((name) => {
      const digest = JSON.parse(fs.readFileSync(path.join(digestDir, name), "utf8"));
      const date = name.replace(/\.json$/, "");
      const topics = topicLabels(digest.press);
      const text = [date, topics.join(" "), outletText(digest.press)]
        .join(" ")
        .toLowerCase();
      return { date, topics, text };
    });
};
