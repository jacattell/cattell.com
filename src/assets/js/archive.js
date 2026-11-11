// Search for the social media archive (/archive/). Loads all posts once, then
// filters them as you type. Without JavaScript, the year pages still work.
(function () {
  const form = document.getElementById("archive-search");
  if (!form) return;
  const input = document.getElementById("archive-q");
  const status = document.getElementById("archive-status");
  const results = document.getElementById("archive-results");
  const more = document.getElementById("archive-more");
  const browse = document.getElementById("archive-browse");
  const NAMES = { bluesky: "Bluesky", mastodon: "Mastodon", linkedin: "LinkedIn", x: "X (Twitter)" };
  const PAGE = 50;
  let items = [];
  let matches = [];
  let shown = 0;

  const dateText = (iso) =>
    new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    e.append(...children);
    return e;
  }

  // Post text with web addresses as links. Built as page elements, never HTML.
  function textWithLinks(text) {
    const div = el("div", { class: "post-text" });
    let last = 0;
    for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"]+/g)) {
      let url = m[0];
      while (/[.,;:!?'")\]]$/.test(url) && !(url.endsWith(")") && url.includes("("))) url = url.slice(0, -1);
      div.append(text.slice(last, m.index), el("a", { href: url }, url));
      last = m.index + url.length;
    }
    div.append(text.slice(last));
    // Keep line breaks.
    div.style.whiteSpace = "pre-line";
    return div;
  }

  // Keep in step with src/_includes/archive-post.njk.
  function render(item) {
    const meta = el("p", { class: "post-meta" }, el("time", { datetime: item.date }, dateText(item.date)));
    if (item.reply) meta.append(" · Reply");
    else if (item.thread) meta.append(" · Thread");
    const article = el("article", { class: "post" }, meta, textWithLinks(item.text));
    for (const img of item.images) {
      const label = img.video ? "Video" : "Image";
      article.append(el("p", { class: "post-media" }, img.url ? el("a", { href: img.url }, label) : label, img.alt ? ": " + img.alt : ""));
    }
    if (item.link && !item.text.includes(item.link.url)) {
      article.append(el("p", { class: "post-media" }, "Link: ", el("a", { href: item.link.url }, item.link.title || item.link.url)));
    }
    if (item.quote) article.append(el("p", { class: "post-media" }, "Quoting ", el("a", { href: item.quote }, "another post")));
    const on = el("p", { class: "post-on" }, "On ");
    item.on.forEach((o, i) => on.append(i ? " · " : "", el("a", { href: o.url }, NAMES[o.platform] || o.platform)));
    article.append(on);
    return article;
  }

  function showMore() {
    const next = matches.slice(shown, shown + PAGE);
    results.append(...next.map(render));
    shown += next.length;
    more.hidden = shown >= matches.length;
  }

  function search() {
    const q = input.value.trim();
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const platforms = [...form.querySelectorAll('input[name="platform"]:checked')].map((c) => c.value);
    const replies = form.querySelector('input[name="replies"]').checked;

    const url = new URL(location.href);
    q ? url.searchParams.set("q", q) : url.searchParams.delete("q");
    history.replaceState(null, "", url);

    results.replaceChildren();
    shown = 0;
    if (!terms.length) {
      browse.hidden = false;
      more.hidden = true;
      status.textContent = "";
      return;
    }
    browse.hidden = true;
    matches = items.filter(
      (item) =>
        (replies || !item.reply) &&
        item.on.some((o) => platforms.includes(o.platform)) &&
        terms.every((t) => item.search.includes(t))
    );
    status.textContent = matches.length === 1 ? "1 post found." : `${matches.length} posts found.`;
    showMore();
  }

  let timer;
  form.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(search, 200);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    search();
  });
  more.addEventListener("click", showMore);

  status.textContent = "Loading posts…";
  fetch("/archive/posts.json")
    .then((r) => r.json())
    .then((data) => {
      items = data.map((i) => ({
        ...i,
        search: (i.text + " " + i.images.map((m) => m.alt).join(" ") + " " + (i.link?.title || "")).toLowerCase(),
      }));
      form.hidden = false;
      status.textContent = "";
      input.value = new URL(location.href).searchParams.get("q") || "";
      if (input.value) search();
    })
    .catch(() => {
      status.textContent = "Search isn't available right now. You can still browse by year.";
    });
})();
