// Turns posts from several platforms into one list for the archive,
// combining cross-posts (the same post on several platforms) into one item.

export const PLATFORMS = { bluesky: "Bluesky", mastodon: "Mastodon", linkedin: "LinkedIn", x: "X (Twitter)" };

const WINDOW_MS = 20 * 60 * 1000; // cross-posts go out within 20 minutes of each other

// Common words that say little about what a post is about.
const COMMON = new Set(
  ("a an and are as at be but by can do for from has have i i'm if in is it its just me my no not of on or our so " +
   "that the their them then there this to too up us was we were what when which who will with you your").split(" ")
);

/** The meaningful words in a post, ignoring web addresses, @mentions, # signs, case, punctuation and common words. */
export function words(text) {
  const cleaned = text
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/g, " ")
    .replace(/@[\w.-]+/g, " ")
    .replace(/#/g, " ");
  return new Set((cleaned.match(/[\p{L}\p{N}]+/gu) || []).filter((w) => !COMMON.has(w)));
}

/** How alike two posts' words are, from 0 to 1. Uses the shorter post, as short platforms get trimmed versions. */
export function likeness(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

/** Combines posts into archive items, newest first. */
export function groupPosts(posts) {
  const sorted = [...posts].sort((a, b) => a.date.localeCompare(b.date));
  const groups = [];
  for (const post of sorted) {
    const time = Date.parse(post.date);
    const postWords = words(post.text);
    let best = null;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (time - g.time > WINDOW_MS) break;
      if (g.posts.some((p) => p.platform === post.platform)) continue;
      const score = Math.max(...g.posts.map((p) => likeness(postWords, words(p.text))));
      const enough = Math.min(postWords.size, ...g.posts.map((p) => words(p.text).size)) >= 3 ? 0.6 : 1;
      if (score >= enough && (!best || score > best.score)) best = { g, score };
    }
    if (best) best.g.posts.push(post);
    else groups.push({ time, posts: [post] });
  }

  return groups
    .map(({ posts: ps }) => {
      const main = ps.reduce((a, b) => (b.text.length > a.text.length ? b : a));
      const withImages = ps.reduce((a, b) => (b.images.length > a.images.length ? b : a));
      const date = ps.map((p) => p.date).sort()[0];
      return {
        id: `${date.slice(0, 10)}-${ps[0].platform}-${ps[0].id}`,
        date,
        year: Number(date.slice(0, 4)),
        text: main.text,
        reply: ps.every((p) => p.reply && !p.reply.self),
        thread: ps.some((p) => p.reply?.self),
        images: withImages.images,
        link: ps.map((p) => p.link).find(Boolean) || null,
        quote: ps.map((p) => p.quote).find(Boolean) || null,
        on: Object.keys(PLATFORMS)
          .map((key) => ps.find((p) => p.platform === key))
          .filter(Boolean)
          .map((p) => ({ platform: p.platform, url: p.url })),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
