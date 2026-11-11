// Downloads James's public Mastodon posts into archive-data/mastodon.json.
// Usage: node scripts/archive/fetch-mastodon.js [--all]
// Without --all it stops once it reaches posts it already has.
import { getJson, readPosts, savePosts } from "./common.js";

const SERVER = "https://mastodon.me.uk";
const ACCT = "jacattell";
const all = process.argv.includes("--all");

const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

// Mastodon gives HTML. Turn it into plain text, with full web addresses for links.
function plainText(html) {
  return decode(
    html
      .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis, (tag, href, inner) => {
        if (/class="[^"]*(mention|hashtag)/.test(tag)) return inner;
        return href;
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
  ).trim();
}

const account = await getJson(`${SERVER}/api/v1/accounts/lookup?acct=${ACCT}`);
const known = new Set(readPosts("mastodon").map((p) => p.id));
const posts = [];
let maxId;
for (;;) {
  const page = await getJson(`${SERVER}/api/v1/accounts/${account.id}/statuses?limit=40&exclude_reblogs=true${maxId ? `&max_id=${maxId}` : ""}`);
  if (!page.length) break;
  let reachedKnown = false;
  for (const s of page) {
    maxId = s.id;
    if (s.visibility !== "public" && s.visibility !== "unlisted") continue; // never publish private posts
    if (known.has(s.id) && !all) reachedKnown = true;
    posts.push({
      platform: "mastodon",
      id: s.id,
      url: s.url,
      date: new Date(s.created_at).toISOString(),
      text: (s.spoiler_text ? `Content warning: ${s.spoiler_text}\n\n` : "") + plainText(s.content),
      reply: s.in_reply_to_id ? { url: null, self: s.in_reply_to_account_id === account.id } : null,
      images: s.media_attachments.map((m) => ({ url: m.url, alt: m.description || "", video: m.type !== "image" || undefined })),
      link: s.card ? { url: s.card.url, title: s.card.title || "" } : null,
      quote: null,
    });
  }
  if (reachedKnown) break;
}

console.log(`Mastodon: ${posts.length} posts downloaded, ${savePosts("mastodon", posts)} saved in total`);
