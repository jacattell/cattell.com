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

/** A smaller preview of an image, from the same service, or null if there isn't one. */
export function thumbnail(url) {
  if (!url) return null;
  if (url.includes("cdn.bsky.app/img/feed_fullsize/")) return url.replace("/feed_fullsize/", "/feed_thumbnail/");
  if (url.includes("/media_attachments/") && url.includes("/original/")) return url.replace("/original/", "/small/");
  return url;
}

/** YouTube videos linked in a post: [{ id, short }], without repeats. Channels and playlists are left out. */
export function youtubeVideos(...texts) {
  const found = new Map();
  const pattern = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?\S*?\bv=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/g;
  for (const text of texts) {
    for (const m of (text || "").matchAll(pattern)) {
      if (!found.has(m[1])) found.set(m[1], { id: m[1], short: m[0].includes("/shorts/") });
    }
  }
  return [...found.values()];
}

/**
 * All the images and videos from a cross-post, without showing the same one twice.
 * Starts with the post that has the most, then adds any others. Two count as the
 * same if their descriptions match closely, or if neither has a description and
 * they are in the same place in their posts. X images (which never have descriptions
 * in the archive) are the same as the image in the same place. (An image on one platform can be a
 * video on another: Mastodon turns animated GIFs into videos.) A post's video also
 * counts as the same as a video already included.
 */
export function mergeImages(posts) {
  const described = (m) => m.alt && m.alt !== "Video";
  const [main, ...rest] = [...posts].sort((a, b) => b.images.length - a.images.length);
  const merged = [...main.images];
  const alike = (a, b) => described(a) && described(b) && likeness(words(a.alt), words(b.alt)) >= 0.7;
  for (const post of rest) {
    post.images.forEach((img, i) => {
      if (img.video) {
        // A video matches one already included unless both have different descriptions.
        const v = merged.findIndex((m) => m.video && (!described(m) || !described(img) || alike(m, img)));
        if (v >= 0) {
          // Prefer the copy with a description and a link.
          if ((!described(merged[v]) && described(img)) || (!merged[v].url && img.url)) merged[v] = img;
          return;
        }
      }
      // The X archive has no image descriptions, so its images are matched by their place in the post.
      if ((main.platform === "x" || post.platform === "x") && main.images[i] && !main.images[i].video === !img.video) {
        if (!described(merged[i]) && described(img)) merged[i] = img;
        return;
      }
      const same = described(img) ? merged.some((m) => alike(m, img)) : main.images[i] && !described(main.images[i]);
      if (!same) merged.push(img);
    });
  }
  return merged;
}

/** YouTube's address for a video's thumbnail picture. */
export const youtubeThumbnail = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/**
 * Combines posts into archive items, newest first. `media` maps an image's original
 * address to the copies saved in the site (see scripts/archive/fetch-media.js); images
 * without a saved copy are loaded from the platform instead.
 */
export function groupPosts(posts, media = {}) {
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
      const date = ps.map((p) => p.date).sort()[0];
      return {
        id: `${date.slice(0, 10)}-${ps[0].platform}-${ps[0].id}`,
        date,
        year: Number(date.slice(0, 4)),
        text: main.text,
        reply: ps.every((p) => p.reply && !p.reply.self),
        thread: ps.some((p) => p.reply?.self),
        images: mergeImages(ps).map((img) => {
          if (img.video) return { ...img, thumb: null };
          const saved = media[img.url];
          if (saved?.unavailable) return { ...img, source: img.url, url: null, thumb: null, alt: img.alt || "no longer available" };
          return { ...img, source: img.url, url: saved ? saved.file : img.url, thumb: saved ? saved.thumb : thumbnail(img.url) };
        }),
        link: ps.map((p) => p.link).find(Boolean) || null,
        videos: youtubeVideos(...ps.map((p) => p.text), ...ps.map((p) => p.link?.url))
          .filter((v) => !media[youtubeThumbnail(v.id)]?.unavailable) // deleted or private videos get no preview
          .map((v) => ({ ...v, thumb: media[youtubeThumbnail(v.id)]?.thumb || youtubeThumbnail(v.id) })),
        quote: ps.map((p) => p.quote).find(Boolean) || null,
        on: Object.keys(PLATFORMS)
          .map((key) => ps.find((p) => p.platform === key))
          .filter(Boolean)
          .map((p) => ({ platform: p.platform, url: p.url })),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
