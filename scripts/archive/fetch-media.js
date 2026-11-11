// Copies the archive's images into the site, so it doesn't depend on Bluesky or
// Mastodon keeping them. Each image shown in the archive is saved once (cross-posted
// copies are skipped) as a web-sized picture and a small preview, with hidden data
// such as location removed. archive-data/media.json records which is which.
// Videos are not copied. Usage: node scripts/archive/fetch-media.js
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { DATA_DIR, readPosts } from "./common.js";
import { groupPosts, PLATFORMS } from "../../lib/archive.js";

const OUT_DIR = path.join(DATA_DIR, "..", "src", "assets", "archive");
const MEDIA_FILE = path.join(DATA_DIR, "media.json");
const media = fs.existsSync(MEDIA_FILE) ? JSON.parse(fs.readFileSync(MEDIA_FILE, "utf8")) : {};

const posts = Object.keys(PLATFORMS).flatMap((key) => readPosts(key));
const wanted = groupPosts(posts)
  .flatMap((item) => item.images)
  .filter((img) => !img.video && img.source);

fs.mkdirSync(OUT_DIR, { recursive: true });
let added = 0, failed = 0;
for (const img of wanted) {
  const name = crypto.createHash("sha1").update(img.source).digest("hex").slice(0, 16);
  const file = `/assets/archive/${name}.webp`, thumb = `/assets/archive/${name}-thumb.webp`;
  if (media[img.source] && fs.existsSync(path.join(OUT_DIR, `${name}.webp`))) continue;
  try {
    const res = await fetch(img.source, { headers: { "User-Agent": "cattell.com archive" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const input = Buffer.from(await res.arrayBuffer());
    const picture = sharp(input).rotate(); // turn to match the camera, then drop hidden data
    await picture.clone().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(OUT_DIR, `${name}.webp`));
    await picture.clone().resize(480, 480, { fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toFile(path.join(OUT_DIR, `${name}-thumb.webp`));
    media[img.source] = { file, thumb };
    added++;
  } catch (err) {
    failed++;
    console.warn(`Could not copy ${img.source}: ${err.message}`);
  }
}

const sorted = Object.fromEntries(Object.entries(media).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(MEDIA_FILE, JSON.stringify(sorted, null, 1) + "\n");
console.log(`Media: ${added} images copied, ${failed} failed, ${Object.keys(media).length} saved in total`);
