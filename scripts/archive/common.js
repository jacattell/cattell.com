// Shared helpers for the social media archive scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, "..", "..", "archive-data");

export async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "cattell.com archive" } });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
}

/** Reads a platform's saved posts (newest first). */
export function readPosts(platform) {
  const file = path.join(DATA_DIR, `${platform}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

/** Merges new posts into the saved ones, keyed by id, and saves them newest first. */
export function savePosts(platform, posts) {
  const byId = new Map(readPosts(platform).map((p) => [p.id, p]));
  for (const p of posts) byId.set(p.id, p);
  const all = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${platform}.json`), JSON.stringify(all, null, 1) + "\n");
  return all.length;
}
