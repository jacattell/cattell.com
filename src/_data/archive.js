// Data for the social media archive (/archive/). Reads each platform's posts
// from archive-data/ (see scripts/archive/) and combines cross-posts.
import fs from "node:fs";
import path from "node:path";
import { groupPosts, PLATFORMS } from "../../lib/archive.js";

const PAGE_SIZE = 200;

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
  // Year pages show this many posts each: some years have thousands.
  const yearPages = years.flatMap(({ year, items: all }) => {
    const pages = Math.ceil(all.length / PAGE_SIZE);
    const url = (n) => (n === 1 ? `/archive/${year}/` : `/archive/${year}/page-${n}/`);
    return Array.from({ length: pages }, (_, i) => ({
      year,
      page: i + 1,
      pages,
      count: all.length,
      url: url(i + 1),
      newer: i > 0 ? url(i) : null,
      older: i + 1 < pages ? url(i + 2) : null,
      items: all.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE),
    }));
  });
  // The chat reads posts from Bluesky and Mastodon (and anything also posted on X).
  // Posts only on X are left out: there are too many for every chat message.
  const chatItems = items.filter((i) => i.on.some((o) => o.platform !== "x"));
  // What the search page downloads: only what it shows, as it's large.
  const searchItems = items.map(({ id, year, ...item }) => ({ ...item, images: item.images.map(({ source, ...img }) => img) }));
  const counts = Object.fromEntries(
    Object.keys(PLATFORMS).map((key) => [key, posts.filter((p) => p.platform === key).length])
  );
  const sources = Object.entries(PLATFORMS)
    .filter(([key]) => counts[key])
    .map(([key, name]) => ({ key, name, count: counts[key] }));
  return { items, years, yearPages, chatItems, searchItems, counts, sources, platforms: PLATFORMS, total: posts.length };
}
