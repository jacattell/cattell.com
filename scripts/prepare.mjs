// Runs before Hugo (npm run build). Uses only Node's own modules: no packages.
//
// Turns the social media archive (archive-data/) into:
//   assets/generated/archive-pages.json  year pages, read by content/archive/_content.gotmpl
//   assets/generated/archive-summary.json counts and the latest posts, for /archive/
//   assets/generated/chat-archive.txt    the posts the AI chat may read
//   static/archive/posts.json            what the archive search downloads
// All are rebuilt each time and are not saved in git.
import fs from "node:fs";
import path from "node:path";
import { groupPosts, PLATFORMS } from "./lib/archive.js";

const PAGE_SIZE = 200;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const data = path.join(root, "archive-data");
const read = (f, fallback) => (fs.existsSync(path.join(data, f)) ? JSON.parse(fs.readFileSync(path.join(data, f), "utf8")) : fallback);
const write = (rel, text) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const num = (n) => Number(n).toLocaleString("en-GB");
const local = (src) => typeof src === "string" && src.startsWith("/");

/** Splits post text into plain text and web addresses, so templates can escape the text and link the addresses. */
export function segments(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(/\bhttps?:\/\/[^\s<>"]+/g)) {
    let url = m[0];
    while (/[.,;:!?'")\]]$/.test(url) && !(url.endsWith(")") && url.includes("("))) url = url.slice(0, -1);
    if (m.index > last) out.push({ t: text.slice(last, m.index) });
    out.push({ u: url });
    last = m.index + url.length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}

/** One archive item in the shape the templates and search use. Only local pictures are shown. */
export function shape(item) {
  const pictures = item.images.filter((i) => !i.video && local(i.thumb) && local(i.url)).map((i) => ({ src: i.thumb, full: i.url, alt: i.alt || "" }));
  const other = item.images.filter((i) => !pictures.some((p) => p.full === i.url)).map((i) => ({
    kind: i.video ? "Video" : "Image",
    url: i.url || item.on[0].url,
    alt: i.alt || "",
  }));
  return {
    date: item.date,
    when: when.format(new Date(item.date)),
    year: item.year,
    text: item.text,
    parts: segments(item.text),
    reply: item.reply,
    thread: item.thread,
    pictures,
    other,
    videos: item.videos.map((v) => ({ url: `https://www.youtube.com/watch?v=${v.id}` })),
    link: item.link && !item.text.includes(item.link.url) ? { url: item.link.url, title: item.link.title || item.link.url } : null,
    quote: item.quote,
    on: item.on.map((o) => ({ name: PLATFORMS[o.platform], platform: o.platform, url: o.url })),
  };
}

export function prepare() {
  const posts = Object.keys(PLATFORMS).flatMap((k) => read(`${k}.json`, []));
  const items = groupPosts(posts, read("media.json", {})).map(shape);
  const years = [...new Set(items.map((i) => i.year))];

  const pages = years.flatMap((year) => {
    const all = items.filter((i) => i.year === year);
    const count = Math.ceil(all.length / PAGE_SIZE);
    const url = (n) => (n === 1 ? `${year}` : `${year}/page-${n}`);
    return Array.from({ length: count }, (_, i) => ({
      path: url(i + 1),
      year,
      page: i + 1,
      pages: count,
      total: num(all.length),
      newer: i > 0 ? `/archive/${url(i)}/` : null,
      older: i + 1 < count ? `/archive/${url(i + 2)}/` : null,
      items: all.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE),
    }));
  });

  const sources = Object.entries(PLATFORMS)
    .map(([key, name]) => ({ key, name, count: posts.filter((p) => p.platform === key).length }))
    .filter((s) => s.count)
    .map((s) => ({ ...s, shown: num(s.count) }));

  const summary = {
    total: num(items.length),
    sources,
    years: years.map((y) => ({ year: y, count: num(items.filter((i) => i.year === y).length) })),
    latest: items.filter((i) => !i.reply).slice(0, 20),
  };

  // The chat reads posts not only on X, and not replies, to keep each message under 100,000 tokens.
  const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();
  const chat = items
    .filter((i) => !i.reply && i.on.some((o) => o.platform !== "x"))
    .map((i) => `${i.when} | ${i.on.map((o) => o.name).join(", ")} | ${i.on[0].url}\n${oneLine(i.text)}` +
      [...i.pictures.map((p) => ` [Image${p.alt ? `: ${oneLine(p.alt).slice(0, 150)}` : ""}]`), ...i.other.map((o) => ` [${o.kind}${o.alt ? `: ${oneLine(o.alt).slice(0, 150)}` : ""}]`), ...i.videos.map((v) => ` [YouTube video: ${v.url}]`)].join(""))
    .join("\n\n");

  const search = items.map(({ parts, year, ...i }) => i);

  write("assets/generated/archive-pages.json", JSON.stringify(pages));
  write("assets/generated/archive-summary.json", JSON.stringify(summary));
  write("assets/generated/chat-archive.txt", chat);
  write("static/archive/posts.json", JSON.stringify(search));
  return { items: items.length, pages: pages.length };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const { items, pages } = prepare();
  console.log(`Archive: ${items} posts on ${pages} pages`);
}
