// Downloads James's public Bluesky posts into archive-data/bluesky.json.
// Usage: node scripts/archive/fetch-bluesky.js [--all]
// Without --all it stops once it reaches posts it already has.
import { getJson, readPosts, savePosts } from "./common.js";

const HANDLE = "jacattell.bsky.social";
const API = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
const all = process.argv.includes("--all");

const webUrl = (atUri) => {
  const [, , did, , rkey] = atUri.split("/");
  return `https://bsky.app/profile/${did === me ? HANDLE : did}/post/${rkey}`;
};

// Bluesky shortens links in the text; facets hold the full addresses. Put them back.
function fullText(record) {
  const bytes = Buffer.from(record.text || "", "utf8");
  const links = (record.facets || [])
    .flatMap((f) => (f.features || []).filter((x) => x.$type === "app.bsky.richtext.facet#link").map((x) => ({ ...f.index, uri: x.uri })))
    .sort((a, b) => b.byteStart - a.byteStart);
  let out = bytes;
  for (const l of links) {
    out = Buffer.concat([out.subarray(0, l.byteStart), Buffer.from(l.uri, "utf8"), out.subarray(l.byteEnd)]);
  }
  return out.toString("utf8");
}

function media(embed) {
  if (!embed) return { images: [], link: null, quote: null };
  const images = (embed.images || embed.media?.images || []).map((i) => ({ url: i.fullsize, alt: i.alt || "" }));
  if (embed.$type?.startsWith("app.bsky.embed.video") || embed.media?.$type?.startsWith("app.bsky.embed.video")) {
    images.push({ url: null, alt: (embed.alt || embed.media?.alt || "Video"), video: true });
  }
  const ext = embed.external || embed.media?.external;
  const rec = embed.record?.record || embed.record;
  const quote = rec?.uri && rec.$type !== "app.bsky.embed.record#viewNotFound" ? webUrl(rec.uri) : null;
  return { images, link: ext ? { url: ext.uri, title: ext.title || "" } : null, quote };
}

let me;
const known = new Set(readPosts("bluesky").map((p) => p.id));
const posts = [];
let cursor;
do {
  const page = await getJson(`${API}?actor=${HANDLE}&filter=posts_with_replies&limit=100${cursor ? `&cursor=${cursor}` : ""}`);
  let reachedKnown = false;
  for (const item of page.feed) {
    const post = item.post;
    me ??= post.author.handle === HANDLE ? post.author.did : undefined;
    if (item.reason || post.author.handle !== HANDLE) continue; // reposts of other people
    const id = post.uri.split("/").pop();
    if (known.has(id) && !all) reachedKnown = true;
    const r = post.record;
    const parent = r.reply?.parent?.uri;
    posts.push({
      platform: "bluesky",
      id,
      url: webUrl(post.uri),
      date: new Date(r.createdAt).toISOString(),
      text: fullText(r),
      reply: parent ? { url: webUrl(parent), self: parent.split("/")[2] === post.author.did } : null,
      ...media(post.embed),
    });
  }
  cursor = reachedKnown ? undefined : page.cursor;
} while (cursor);

console.log(`Bluesky: ${posts.length} posts downloaded, ${savePosts("bluesky", posts)} saved in total`);
