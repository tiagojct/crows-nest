const fs = require("node:fs");
const path = require("node:path");

module.exports = function digestsData() {
  const digestDir = path.join(process.cwd(), "src", "_data", "digest");

  if (!fs.existsSync(digestDir)) {
    return [];
  }

  const files = fs
    .readdirSync(digestDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort((a, b) => b.localeCompare(a));

  return files.map((fileName) => {
    const fullPath = path.join(digestDir, fileName);
    const raw = fs.readFileSync(fullPath, "utf8");
    const digest = JSON.parse(raw);
    return {
      date: fileName.replace(/\.json$/, ""),
      ...digest
    };
  });
};
