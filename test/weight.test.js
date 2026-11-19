// Page weight budget. Smaller pages use less data and less energy to send and
// show, so they are cheaper for readers and lower in emissions. No packages.
//
// The limits, for every page in public/ (npm test builds it first):
//   code and text  HTML, CSS and JavaScript, compressed as Cloudflare sends them
//   eager images   pictures downloaded straight away (not loading="lazy")
//   any one image  a single picture file
//   whole page     everything, including pictures that load as the reader scrolls
// If a test fails, shrink the picture (about 1000 pixels wide is plenty), add
// loading="lazy", or split the page. Change a limit only on purpose.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const KB = 1024;
const LIMITS = { code: 100 * KB, eager: 500 * KB, image: 500 * KB, total: 2048 * KB };

const OUT = "public";
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const pages = walk(OUT).filter((f) => f.endsWith(".html") && !f.includes(`${path.sep}assets${path.sep}`));
const gz = (f) => zlib.gzipSync(fs.readFileSync(f)).length;
const kb = (n) => `${Math.round(n / KB)} KB`;

const sizes = new Map();
const fileSize = (url, compress) => {
  const key = `${url} ${compress}`;
  if (!sizes.has(key)) {
    const f = path.join(OUT, url.split(/[?#]/)[0]);
    assert.ok(fs.existsSync(f), `missing file ${url}`);
    sizes.set(key, compress ? gz(f) : fs.statSync(f).size);
  }
  return sizes.get(key);
};

const weigh = (f) => {
  const html = fs.readFileSync(f, "utf8");
  let code = gz(f);
  for (const [, url] of html.matchAll(/<(?:link\b[^>]*rel="stylesheet"[^>]*href|script\b[^>]*src)="(\/[^"]+)"/g)) code += fileSize(url, true);
  let eager = 0, lazy = 0;
  const images = [];
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    const url = /\bsrc="(\/[^"]+)"/.exec(tag)?.[1];
    if (!url) continue;
    const size = fileSize(url, url.endsWith(".svg"));
    images.push([url, size]);
    if (/\bloading="lazy"/.test(tag)) lazy += size;
    else eager += size;
  }
  return { code, eager, images, total: code + eager + lazy };
};

const weights = pages.map((f) => [f, weigh(f)]);

test(`page weight: code and text are under ${kb(LIMITS.code)} on every page`, () => {
  for (const [f, w] of weights) assert.ok(w.code <= LIMITS.code, `${f}: ${kb(w.code)}`);
});

test(`page weight: pictures that load straight away are under ${kb(LIMITS.eager)} on every page`, () => {
  for (const [f, w] of weights) assert.ok(w.eager <= LIMITS.eager, `${f}: ${kb(w.eager)} (add loading="lazy" or shrink the pictures)`);
});

test(`page weight: no single picture is over ${kb(LIMITS.image)}`, () => {
  for (const [f, w] of weights) for (const [url, size] of w.images) assert.ok(size <= LIMITS.image, `${url} on ${f}: ${kb(size)}`);
});

test(`page weight: every page, with all its pictures, is under ${kb(LIMITS.total)}`, () => {
  for (const [f, w] of weights) assert.ok(w.total <= LIMITS.total, `${f}: ${kb(w.total)}`);
});

test("page weight: pictures in week notes load only when needed", () => {
  for (const [tag] of fs.readFileSync(path.join(OUT, "week-notes/2021/41/index.html"), "utf8").matchAll(/<img\b[^>]*>/g)) assert.match(tag, /loading="lazy"/);
});
