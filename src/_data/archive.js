// Data for the social media archive (/archive/). Reads each platform's posts
// from archive-data/ (see scripts/archive/) and combines cross-posts.
import fs from "node:fs";
import path from "node:path";
import { groupPosts, PLATFORMS } from "../../lib/archive.js";

export default function () {
  const dir = "archive-data";
  const posts = Object.keys(PLATFORMS).flatMap((key) => {
    const file = path.join(dir, `${key}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  });
  const mediaFile = path.join(dir, "media.json");
  const media = fs.existsSync(mediaFile) ? JSON.parse(fs.readFileSync(mediaFile, "utf8")) : {};
  const items = groupPosts(posts, media);
  const years = [...new Set(items.map((i) => i.year))].map((year) => ({
    year,
    items: items.filter((i) => i.year === year),
  }));
  const counts = Object.fromEntries(
    Object.keys(PLATFORMS).map((key) => [key, posts.filter((p) => p.platform === key).length])
  );
  const sources = Object.entries(PLATFORMS)
    .filter(([key]) => counts[key])
    .map(([key, name]) => ({ key, name, count: counts[key] }));
  return { items, years, counts, sources, platforms: PLATFORMS, total: posts.length };
}
