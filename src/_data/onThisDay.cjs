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

function topicLabels(group) {
  const topics = Array.isArray(group?.topics) ? group.topics : [];
  return topics
    .map((t) => (typeof t === "string" ? t : t?.label))
    .filter(Boolean);
}

// "On this day": digests from prior years sharing today's month-day. Returns an
// empty list until the archive is at least a year deep - that is expected.
module.exports = function onThisDayData() {
  const digestDir = path.join(process.cwd(), "src", "_data", "digest");
  if (!fs.existsSync(digestDir)) {
    return [];
  }

  const today = lisbonToday();
  const [todayYear, monthDay] = [today.slice(0, 4), today.slice(5)];

  return fs
    .readdirSync(digestDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace(/\.json$/, ""))
    .filter((date) => date.slice(5) === monthDay && date.slice(0, 4) < todayYear)
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const digest = JSON.parse(fs.readFileSync(path.join(digestDir, `${date}.json`), "utf8"));
      return {
        date,
        yearsAgo: Number(todayYear) - Number(date.slice(0, 4)),
        topics: topicLabels(digest.press)
      };
    });
};
