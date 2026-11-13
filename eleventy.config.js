import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as sass from "sass";

// Monday of an ISO week, as a UTC date.
function isoWeekStart(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  return monday;
}

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");

  // Hidden GOV.UK Design System version (/govuk/): GOV.UK Frontend's JavaScript,
  // and its styles compiled with an ordinary font (see src/govuk/govuk.scss).
  eleventyConfig.addPassthroughCopy({ "node_modules/govuk-frontend/dist/govuk/govuk-frontend.min.js": "govuk/assets/govuk-frontend.min.js" });
  eleventyConfig.addWatchTarget("src/govuk/govuk.scss");
  eleventyConfig.on("eleventy.before", ({ directories }) => {
    const css = sass.compile("src/govuk/govuk.scss", { loadPaths: ["node_modules"], style: "compressed", quietDeps: true, silenceDeprecations: ["import"] }).css;
    const out = path.join(directories.output, "govuk", "assets", "govuk.css");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, css);
  });
  // A Content-Security-Policy hash for an inline script, e.g. sha256-… (wrap it in single quotes).
  eleventyConfig.addFilter("cspHash", (text) => `sha256-${crypto.createHash("sha256").update(String(text)).digest("base64")}`);
  eleventyConfig.addFilter("govukCssVersion", () => {
    const file = "src/govuk/govuk.scss";
    return crypto.createHash("sha256").update(fs.readFileSync(file)).update(fs.readFileSync("node_modules/govuk-frontend/package.json")).digest("hex").slice(0, 8);
  });

  // Every page of the main site, for the GOV.UK version to copy.
  eleventyConfig.addCollection("govukPages", (api) =>
    api
      .getAll()
      .filter((p) => (p.outputPath || "").endsWith(".html") && p.url !== "/404.html" && !p.url.startsWith("/govuk/"))
      // Year pages have their own GOV.UK templates (src/govuk/*-years.njk).
      .filter((p) => !/^\/(archive|week-notes)\/\d{4}\/$/.test(p.url))
      // The editor is not copied.
      .filter((p) => !p.url.startsWith("/edit/"))
  );

  // In the GOV.UK version, give each page's own content GOV.UK's styles, and keep
  // its links inside the GOV.UK version.
  const addClass = (tag, attrs, cls) => {
    if (/\bclass="/.test(attrs)) return attrs.includes("govuk-") ? `<${tag}${attrs}>` : `<${tag}${attrs.replace(/\bclass="/, `class="${cls} `)}>`;
    return `<${tag} class="${cls}"${attrs}>`;
  };
  const govukise = (html) =>
    html
      .replace(/<(h1)(\s[^>]*)?>/g, (m, t, a = "") => addClass(t, a, "govuk-heading-xl"))
      .replace(/<(h2)(\s[^>]*)?>/g, (m, t, a = "") => addClass(t, a, "govuk-heading-l"))
      .replace(/<(h3)(\s[^>]*)?>/g, (m, t, a = "") => addClass(t, a, "govuk-heading-m"))
      .replace(/<(h4)(\s[^>]*)?>/g, (m, t, a = "") => addClass(t, a, "govuk-heading-s"))
      .replace(/<(p)(\s[^>]*)?>/g, (m, t, a = "") => addClass(t, a, "govuk-body"))
      .replace(/<(ul)(\s[^>]*)?>/g, (m, t, a = "") => (a.includes("class=") ? m : addClass(t, a, "govuk-list govuk-list--bullet")))
      .replace(/<(ol)(\s[^>]*)?>/g, (m, t, a = "") => (a.includes("class=") ? m : addClass(t, a, "govuk-list govuk-list--number")))
      .replace(/<(a)(\s[^>]*)>/g, (m, t, a) => (a.includes("class=") ? m : addClass(t, a, "govuk-link")))
      .replace(/<(table)(\s[^>]*)?>/g, (m, t, a = "") => addClass(t, a, "govuk-table"))
      .replace(/<(label)(\s[^>]*)?>/g, (m, t, a = "") => (a.includes("class=") ? m : addClass(t, a, "govuk-label govuk-label--s")))
      .replace(/<(legend)(\s[^>]*)?>/g, (m, t, a = "") => addClass(t, a, "govuk-fieldset__legend govuk-fieldset__legend--s"))
      .replace(/<(textarea)(\s[^>]*)?>/g, (m, t, a = "") => addClass(t, a, "govuk-textarea"))
      .replace(/<(input)(\s[^>]*type="(?:text|email|search)"[^>]*)>/g, (m, t, a) => addClass(t, a, "govuk-input"))
      .replace(/<(button)(\s[^>]*)>/g, (m, t, a) => (/class="[^"]*secondary/.test(a) ? addClass(t, a.replace(/class="secondary"/, 'class="govuk-button govuk-button--secondary"'), "") : addClass(t, a, "govuk-button")))
      .replace(/(href|action)="\/(?!govuk\/|assets\/|api\/|edit\/|favicon|[^"]*\.(?:xml|json|txt|svg|webp|jpg|png)")([^"]*)"/g, '$1="/govuk/$2"');
  eleventyConfig.addTransform("govuk-version", function (content) {
    if (!(this.page.outputPath || "").endsWith(".html") || !this.page.url.startsWith("/govuk/")) return content;
    return content.replace(/(<main\b[^>]*>)([\s\S]*?)(<\/main>)/, (m, open, inner, close) => open + govukise(inner) + close);
  });
  eleventyConfig.addPassthroughCopy({ "src/assets/favicon.svg": "favicon.svg" });

  // Week notes, oldest first. Year and week come from the file path:
  // src/week-notes/2026/14.md -> /week-notes/2026/14/
  eleventyConfig.addCollection("weekNotes", (api) =>
    api
      .getFilteredByGlob("src/week-notes/[0-9][0-9][0-9][0-9]/*.md")
      .sort((a, b) => a.data.year - b.data.year || a.data.week - b.data.week)
  );

  // Notes grouped by year, newest year and newest note first.
  eleventyConfig.addCollection("noteYears", (api) => {
    const years = new Map();
    for (const note of api.getFilteredByGlob("src/week-notes/[0-9][0-9][0-9][0-9]/*.md")) {
      if (!years.has(note.data.year)) years.set(note.data.year, []);
      years.get(note.data.year).push(note);
    }
    return [...years.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, notes]) => ({
        year,
        notes: notes.sort((a, b) => b.data.week - a.data.week),
      }));
  });

  // The unconference book, in reading order.
  eleventyConfig.addCollection("unconferenceBook", (api) =>
    api
      .getFilteredByGlob("src/unconference/*.md")
      .filter((p) => p.data.bookOrder !== undefined)
      .sort((a, b) => a.data.bookOrder - b.data.bookOrder)
  );

  // Unconference blog posts: the pages in src/unconference that are not book chapters.
  eleventyConfig.addCollection("unconferencePosts", (api) =>
    api
      .getFilteredByGlob("src/unconference/*.md")
      .filter((p) => p.data.bookOrder === undefined)
      .sort((a, b) => a.data.title.localeCompare(b.data.title))
  );

  // Adds a short fingerprint of a file's contents to its address, for example
  // /assets/css/site.css?v=1a2b3c4d. When the file changes, the address changes,
  // so browsers fetch the new version instead of using an old copy they saved.
  eleventyConfig.addFilter("versioned", (url) => {
    const file = path.join("src", url);
    if (!fs.existsSync(file)) return url;
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
    return `${url}?v=${hash}`;
  });

  eleventyConfig.addGlobalData("isoWeekStart", () => isoWeekStart);

  eleventyConfig.addFilter("isoDate", (d) => d.toISOString());
  eleventyConfig.addFilter("longDate", (d) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
  );
  eleventyConfig.addFilter("absoluteUrls", (html, base) =>
    String(html).replace(/(href|src)="\//g, `$1="${base}/`)
  );
  // Social media archive: post text as safe HTML, with links and line breaks.
  const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  eleventyConfig.addFilter("postHtml", (text) => {
    const address = /\bhttps?:\/\/[^\s<>"]+/g;
    let html = "";
    let last = 0;
    for (const m of text.matchAll(address)) {
      let url = m[0];
      while (/[.,;:!?'")\]]$/.test(url) && !(url.endsWith(")") && url.includes("("))) url = url.slice(0, -1);
      html += escapeHtml(text.slice(last, m.index)) + `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
      last = m.index + url.length;
    }
    html += escapeHtml(text.slice(last));
    return html.replace(/\n/g, "<br>");
  });
  eleventyConfig.addFilter("number", (n) => Number(n).toLocaleString("en-GB"));
  eleventyConfig.addFilter("archiveDate", (iso) =>
    new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
  );

  // The page's own source file on GitHub, for the footer's "Source on GitHub" link.
  eleventyConfig.addFilter("githubSource", (inputPath) =>
    `https://github.com/jacattell/cattell.com/blob/main/${String(inputPath).replace(/^\.\//, "")}`
  );

  eleventyConfig.addFilter("oneLine", (text) => String(text).replace(/\s+/g, " ").trim());

  eleventyConfig.addFilter("stripTags", (html) =>
    String(html).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim()
  );

  // Leave out images that are not in the repo yet, so pages never show a broken image.
  const missing = new Set();
  eleventyConfig.addTransform("skip-missing-images", function (content) {
    if (!(this.page.outputPath || "").endsWith(".html")) return content;
    const isMissing = (src) => {
      if (fs.existsSync(path.join("src", src))) return false;
      missing.add(src);
      return true;
    };
    // An image that is a link on its own: keep the link, using the image's description as its text.
    content = content.replace(
      /(<a\b[^>]*>)\s*<img\b[^>]*\bsrc="(\/assets\/img\/[^"]+)"[^>]*\balt="([^"]*)"[^>]*>\s*(<\/a>)/g,
      (tag, open, src, alt, close) => (isMissing(src) ? (alt ? open + alt + close : "") : tag)
    );
    return content.replace(/<img\b[^>]*\bsrc="(\/assets\/img\/[^"]+)"[^>]*>/g, (tag, src) => (isMissing(src) ? "" : tag));
  });
  eleventyConfig.on("eleventy.after", () => {
    if (missing.size) console.warn(`[images] ${missing.size} image(s) not found in src/assets/img: ${[...missing].join(", ")}`);
  });

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
  };
}
