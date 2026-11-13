// Imports posts from a LinkedIn data export into archive-data/linkedin.json.
// Get the export from LinkedIn: Settings > Data privacy > Get a copy of your data >
// "Download larger data archive". Only Shares.csv (posts) and Rich_Media.csv (their
// photos) are read; nothing else in the export is used.
//
// Only posts anyone can see are kept. The export doesn't say who could see each post,
// so each one is opened on LinkedIn without signing in, and posts that ask you to sign
// in (connections-only posts, group posts, and some very old posts) are left out.
// lnkd.in short links are replaced with where they go.
//
// Photo links in the export stop working after a few days, so run fetch-media.js
// straight afterwards to copy them into the site.
// Usage: node scripts/archive/import-linkedin.js path/to/Shares.csv path/to/Rich_Media.csv
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, readPosts } from "./common.js";

/** Reads a CSV file into objects, one per row, keyed by the header row. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows.filter((r) => r.some((f) => f !== ""));
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, ""), r[i] ?? ""])));
}

/** A post's text. The export wraps each line break in stray quote marks. */
export const cleanText = (text) => text.replace(/"\n"/g, "\n").replace(/[ \t]+\n/g, "\n").trim();

/** The post's ID and its address on LinkedIn. */
export function postAddress(shareLink) {
  const urn = decodeURIComponent(shareLink.replace(/^.*\/feed\/update\//, "").replace(/\/$/, ""));
  return { urn, id: urn.split(":").pop(), url: `https://www.linkedin.com/feed/update/${urn}/` };
}

/** "You uploaded a feed photo on November 6, 2026 at 9:05 PM (GMT)" → the time, to the minute. */
export function richMediaTime(text) {
  const m = /on (\w+ \d+, \d{4}) at (\d+):(\d+) (AM|PM)/.exec(text);
  if (!m) return null;
  const d = new Date(`${m[1]} 00:00:00 GMT`);
  d.setUTCHours((Number(m[2]) % 12) + (m[4] === "PM" ? 12 : 0), Number(m[3]));
  return d.toISOString().slice(0, 16);
}

/** Turns the export's rows into archive posts (before the public check). */
export function fromExport(shares, richMedia) {
  const photos = richMedia
    .filter((m) => m["Media Link"] && / (?:feed photo|photo|video) on /.test(m["Date/Time"]) && !/profile/.test(m["Date/Time"]))
    .map((m) => ({ time: richMediaTime(m["Date/Time"]), text: cleanText(m["Media Description"] || ""), url: m["Media Link"], video: m["Media Link"].includes("/playlist/vid/") }));
  return shares.map((s) => {
    const { urn, id, url } = postAddress(s.ShareLink);
    const date = new Date(s.Date.replace(" ", "T") + "Z").toISOString();
    const text = cleanText(s.ShareCommentary || "");
    // A post's photos have its text as their description, or were uploaded in the few minutes before it.
    const minutes = (p) => (Date.parse(date.slice(0, 16) + "Z") - Date.parse(p.time + "Z")) / 6e4;
    const images = photos
      .filter((p) => (minutes(p) >= 0 && minutes(p) <= 3) || (text && p.text === text && Math.abs(minutes(p)) < 60))
      .map((p) => (p.video ? { url: null, alt: "Video", video: true } : { url: p.url, alt: "" }));
    return {
      platform: "linkedin",
      id,
      urn,
      url,
      date,
      text,
      reply: null,
      images,
      link: s.SharedUrl ? { url: s.SharedUrl, title: null } : null,
      quote: null,
    };
  });
}

const browser = { "User-Agent": "Mozilla/5.0 (compatible; cattell.com archive)" };
const pause = () => new Promise((r) => setTimeout(r, 1000));

/** True if anyone can see the post without signing in to LinkedIn. */
async function isPublic(url) {
  const res = await fetch(url, { headers: browser, redirect: "follow" });
  return res.ok && !/\/(signup|authwall|login)/.test(new URL(res.url).pathname);
}

/** Where an lnkd.in short link goes, or the short link if that can't be found. */
async function expand(short) {
  try {
    const html = await (await fetch(short, { headers: browser })).text();
    return /data-tracking-control-name="external_url_click"[^>]*href="([^"]+)"/.exec(html)?.[1].replace(/&amp;/g, "&") || short;
  } catch {
    return short;
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [sharesFile, mediaFile] = process.argv.slice(2);
  if (!sharesFile) { console.error("Usage: node scripts/archive/import-linkedin.js Shares.csv [Rich_Media.csv]"); process.exit(1); }
  const shares = parseCsv(fs.readFileSync(sharesFile, "utf8"));
  const media = mediaFile ? parseCsv(fs.readFileSync(mediaFile, "utf8")) : [];
  const saved = new Map(readPosts("linkedin").map((p) => [p.id, p]));
  const kept = [];
  let hidden = 0;
  for (const post of fromExport(shares, media)) {
    if (saved.has(post.id)) { kept.push({ ...post, text: saved.get(post.id).text }); continue; } // checked before
    if (post.urn.includes("groupPost") || !(await isPublic(post.url))) { hidden++; await pause(); continue; }
    kept.push(post);
    await pause();
    if ((kept.length + hidden) % 50 === 0) console.log(`${kept.length + hidden} of ${shares.length} checked…`);
  }
  for (const post of kept) {
    for (const short of new Set(post.text.match(/https?:\/\/lnkd\.in\/[\w-]+/g) || [])) {
      post.text = post.text.split(short).join(await expand(short));
      await pause();
    }
  }
  kept.sort((a, b) => b.date.localeCompare(a.date));
  fs.writeFileSync(path.join(DATA_DIR, "linkedin.json"), JSON.stringify(kept.map(({ urn, ...p }) => p), null, 1) + "\n");
  console.log(`LinkedIn: ${kept.length} public posts saved, ${hidden} left out (not public)`);
}
