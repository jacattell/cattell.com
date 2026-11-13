// Imports tweets from an X (Twitter) archive download into archive-data/x.json.
// Get the archive from X: Settings > Your account > Download an archive of your data.
// Only data/tweets.js is needed. Retweets are left out; your own tweets, threads and
// replies are kept. Images are copied into the site by fetch-media.js, as for the
// other platforms.
// Usage: node scripts/archive/import-x.js path/to/tweets.js
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./common.js";

const HANDLE = "jaCattell";
const USER_ID = "118012929";

const decode = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** A tweet's time. A few old tweets have a wrong date in the archive, so newer IDs are trusted instead. */
export function tweetDate(t) {
  const id = BigInt(t.id_str);
  if (id > 29700859247n) return new Date(Number(id >> 22n) + 1288834974657).toISOString();
  return new Date(t.created_at).toISOString();
}

const status = /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/\w+\/status(?:es)?\/\d+/;

/** Turns one tweet from the archive into an archive post, or null for a retweet. */
export function fromTweet(t) {
  if (/^RT @\w+:/.test(t.full_text)) return null;
  let text = t.full_text;
  // t.co short links: show where they really go. Links to the tweet's own pictures are removed.
  for (const u of t.entities?.urls || []) text = text.split(u.url).join(u.expanded_url || u.url);
  for (const m of t.extended_entities?.media || t.entities?.media || []) text = text.split(m.url).join("");
  text = decode(text);
  const replyTo = t.in_reply_to_status_id_str;
  // Replies start with the @names of the people replied to; the post links to the conversation instead.
  if (replyTo) text = text.replace(/^(?:@\w+\s+)+/, "");
  const quoteUrl = (t.entities?.urls || []).map((u) => u.expanded_url).find((u) => status.test(u || "") && !u.includes(`/status/${t.id_str}`));
  let quote = null;
  if (quoteUrl) {
    quote = quoteUrl.replace(/\?.*$/, "");
    if (text.trimEnd().endsWith(quoteUrl)) text = text.trimEnd().slice(0, -quoteUrl.length);
  }
  const images = (t.extended_entities?.media || []).map((m) => {
    if (m.type === "photo") return { url: m.media_url_https, alt: "" };
    const mp4 = (m.video_info?.variants || []).filter((v) => v.content_type === "video/mp4").sort((a, b) => Number(b.bitrate) - Number(a.bitrate))[0];
    return { url: mp4?.url || null, alt: m.type === "animated_gif" ? "Animated GIF" : "Video", video: true };
  });
  return {
    platform: "x",
    id: t.id_str,
    url: `https://x.com/${HANDLE}/status/${t.id_str}`,
    date: tweetDate(t),
    text: text.trim(),
    reply: replyTo ? { url: `https://x.com/${t.in_reply_to_screen_name || "i"}/status/${replyTo}`, self: t.in_reply_to_user_id_str === USER_ID } : null,
    images,
    link: null,
    quote,
  };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const file = process.argv[2];
  if (!file) { console.error("Usage: node scripts/archive/import-x.js path/to/tweets.js"); process.exit(1); }
  const raw = fs.readFileSync(file, "utf8");
  const tweets = JSON.parse(raw.slice(raw.indexOf("["))).map((x) => x.tweet);
  const posts = tweets.map(fromTweet).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
  // One post per line keeps this large file readable and its changes small.
  fs.writeFileSync(path.join(DATA_DIR, "x.json"), "[\n" + posts.map((p) => JSON.stringify(p)).join(",\n") + "\n]\n");
  console.log(`X: ${posts.length} posts saved (${tweets.length - posts.length} retweets left out)`);
}
