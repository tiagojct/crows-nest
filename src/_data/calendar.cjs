const fs = require("node:fs");
const path = require("node:path");

const TIMEZONE = "Europe/Lisbon";
const WEEKS = 18;

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

function isoOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function topicCount(digest) {
  return Array.isArray(digest?.press?.topics) ? digest.press.topics.length : 0;
}

function level(count) {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}

// Calendar heatmap source: one cell per day for the last WEEKS weeks, aligned to
// Monday-start weeks so the template can lay it out as a 7-row CSS grid.
module.exports = function calendarData() {
  const digestDir = path.join(process.cwd(), "src", "_data", "digest");
  const counts = {};
  if (fs.existsSync(digestDir)) {
    for (const name of fs.readdirSync(digestDir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
      const date = name.replace(/\.json$/, "");
      const digest = JSON.parse(fs.readFileSync(path.join(digestDir, name), "utf8"));
      counts[date] = topicCount(digest);
    }
  }

  const today = lisbonToday();
  const end = toUTC(today);
  const startRaw = end - (WEEKS * 7 - 1) * 86400000;
  const startWeekday = (new Date(startRaw).getUTCDay() + 6) % 7; // Monday = 0
  const start = startRaw - startWeekday * 86400000;

  const days = [];
  for (let t = start; t <= end; t += 86400000) {
    const date = isoOf(t);
    const count = counts[date] ?? 0;
    days.push({ date, count, level: level(count), hasDigest: date in counts });
  }

  return { today, weeks: WEEKS, days };
};
