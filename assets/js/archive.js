// Search for the social media archive (/archive/). Loads all posts when you start
// to search, then filters them as you type. Without JavaScript, the year pages still work.
// Posts are built as page elements, never as HTML, so nothing in a post can run as code.
(() => {
  const form = document.querySelector(".archive-search");
  if (!form) return;
  const input = form.querySelector("#archive-q");
  const status = document.querySelector(".archive-status");
  const results = document.querySelector(".archive-results");
  const more = document.querySelector(".archive-more");
  const browse = document.querySelector(".archive-browse");
  const PAGE = 50;
  let items = [];
  let matches = [];
  let shown = 0;

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    e.append(...children);
    return e;
  }

  // Only web addresses become links.
  function textWithLinks(text) {
    const p = el("p", { class: "post-text" });
    let last = 0;
    for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"]+/g)) {
      let url = m[0];
      while (/[.,;:!?'")\]]$/.test(url) && !(url.endsWith(")") && url.includes("("))) url = url.slice(0, -1);
      p.append(text.slice(last, m.index), el("a", { href: url }, url));
      last = m.index + url.length;
    }
    p.append(text.slice(last));
    return p;
  }

  // Keep in step with layouts/_partials/archive-post.html.
  function render(item) {
    const meta = el("p", { class: "post-meta" }, el("time", { datetime: item.date }, item.when));
    if (item.reply) meta.append(" · Reply");
    else if (item.thread) meta.append(" · Thread");
    const article = el("article", { class: "post", tabindex: "-1" }, meta, textWithLinks(item.text));
    if (item.pictures.length) {
      const list = el("ul", { class: "post-images" });
      for (const pic of item.pictures) {
        list.append(el("li", {}, el("a", { href: pic.full }, el("img", { src: pic.src, alt: pic.alt || "Image without a description", loading: "lazy", decoding: "async" }))));
      }
      article.append(list);
    }
    for (const o of item.other) article.append(el("p", { class: "post-extra" }, el("a", { href: o.url }, o.kind), o.alt ? ": " + o.alt : ""));
    for (const v of item.videos) article.append(el("p", { class: "post-extra" }, el("a", { href: v.url }, "Video on YouTube")));
    if (item.link) article.append(el("p", { class: "post-extra" }, "Link: ", el("a", { href: item.link.url }, item.link.title)));
    if (item.quote) article.append(el("p", { class: "post-extra" }, "Quoting ", el("a", { href: item.quote }, "another post")));
    const on = el("p", { class: "post-on" }, "On ");
    item.on.forEach((o, i) => on.append(i ? " · " : "", el("a", { href: o.url }, o.name)));
    article.append(on);
    return article;
  }

  function showMore(moveFocus) {
    const next = matches.slice(shown, shown + PAGE).map(render);
    results.append(...next);
    shown += next.length;
    more.hidden = shown >= matches.length;
    // Keyboard and screen reader users carry on from the first new post.
    if (moveFocus && next[0]) next[0].focus();
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
    matches = items.filter((item) =>
      (replies || !item.reply) && item.on.some((o) => platforms.includes(o.platform)) && terms.every((t) => item.search.includes(t))
    );
    status.textContent = matches.length === 1 ? "1 post found." : `${matches.length.toLocaleString("en-GB")} posts found.`;
    showMore(false);
  }

  // All the posts are a large download, so they only load once someone starts to search.
  let loading = null;
  let ready = false;
  function load() {
    if (loading) return loading;
    status.textContent = "Loading posts…";
    loading = fetch("/archive/posts.json")
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((data) => {
        items = data.map((i) => ({
          ...i,
          search: [i.text, ...i.pictures.map((p) => p.alt), ...i.other.map((o) => o.alt), i.link ? i.link.title : ""].join(" ").toLowerCase(),
        }));
        status.textContent = "";
        ready = true;
        search();
      })
      .catch(() => {
        loading = null;
        status.textContent = "Search is not working right now. You can still browse by year.";
      });
    return loading;
  }

  const run = () => (ready ? search() : load());
  let timer;
  form.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
  more.addEventListener("click", () => showMore(true));
  form.hidden = false;
  input.addEventListener("focus", load);
  input.value = new URL(location.href).searchParams.get("q") || "";
  if (input.value) load();
})();
