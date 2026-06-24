const fs = require("node:fs");
const path = require("node:path");

const SPARK_W = 160;
const SPARK_H = 28;

function loadTopics() {
  const topicsPath = path.join(process.cwd(), "src", "_data", "topics.json");
  if (!fs.existsSync(topicsPath)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(topicsPath, "utf8"));
  return Array.isArray(parsed?.topics) ? parsed.topics : [];
}

function toUTC(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// Cumulative-occurrence sparkline: a rising polyline showing how a topic's
// coverage accrued from firstSeen to lastSeen. Single-occurrence topics get one
// point that the template renders as a dot.
function sparkline(occurrences) {
  const occ = [...occurrences].sort();
  if (occ.length === 0) return { points: "", single: true };
  const first = toUTC(occ[0]);
  const last = toUTC(occ[occ.length - 1]);
  const span = last - first;
  const points = occ.map((date, i) => {
    const x = span === 0 ? SPARK_W : ((toUTC(date) - first) / span) * SPARK_W;
    const y = SPARK_H - ((i + 1) / occ.length) * SPARK_H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return { points: points.join(" "), single: occ.length === 1 };
}

module.exports = function topicPagesData() {
  return loadTopics()
    .map((topic) => {
      const occurrences = Array.isArray(topic.occurrences) ? [...topic.occurrences].sort() : [];
      const spark = sparkline(occurrences);
      return {
        id: topic.id,
        label: topic.label,
        group: topic.group,
        aliases: Array.isArray(topic.aliases) ? topic.aliases : [],
        occurrences: occurrences.slice().reverse(),
        count: occurrences.length,
        firstSeen: topic.firstSeen,
        lastSeen: topic.lastSeen,
        articles: Array.isArray(topic.articles) ? topic.articles : [],
        sparkPoints: spark.points,
        sparkSingle: spark.single,
        sparkWidth: SPARK_W,
        sparkHeight: SPARK_H
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};
