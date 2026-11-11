import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

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
    if (missing.size) console.warn(`[images] ${missing.size} image(s) not found in src/assets/img (see IMAGES.md)`);
  });

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
  };
}
