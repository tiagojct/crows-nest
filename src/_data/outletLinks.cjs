const fs = require("node:fs");
const path = require("node:path");

function homepageFromFeedUrl(url) {
  return new URL(url).origin;
}

module.exports = function outletLinksData() {
  const feedsPath = path.join(process.cwd(), "feeds.json");
  const raw = fs.readFileSync(feedsPath, "utf8");
  const feeds = JSON.parse(raw);
  const links = {};

  for (const outlets of Object.values(feeds)) {
    for (const outlet of outlets) {
      links[outlet.name] = homepageFromFeedUrl(outlet.url);
    }
  }

  return links;
};
