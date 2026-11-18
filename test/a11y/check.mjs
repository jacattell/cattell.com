// Checks the built website against WCAG 2.2 A and AA with axe, in light and dark mode,
// and checks a few things by keyboard. Usage: node test/a11y/check.mjs public
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const root = path.resolve(process.argv[2] || "public");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json", ".xml": "application/xml" };
const server = http.createServer((req, res) => {
  let f = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404, { "content-type": "text/html" }); return fs.createReadStream(path.join(root, "404.html")).pipe(res); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const base = `http://localhost:${server.address().port}`;

// Every page except the archive's year pages, of which two are checked.
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const urls = walk(root).filter((f) => f.endsWith(".html")).map((f) => "/" + path.relative(root, f).replace(/index\.html$/, "").split(path.sep).join("/"))
  .filter((u) => !/^\/archive\/\d{4}\//.test(u)).concat(["/archive/2012/", "/archive/2012/page-2/"]);

const browser = await chromium.launch();
let failures = 0;
for (const colorScheme of ["light", "dark"]) {
  const context = await browser.newContext({ colorScheme });
  const page = await context.newPage();
  for (const url of urls) {
    await page.goto(base + url);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    for (const v of violations) {
      failures++;
      console.log(`✗ [${colorScheme}] ${url} ${v.id}: ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) console.log(`    ${n.target.join(" ")}`);
    }
  }
  await context.close();
}

// Keyboard: the first Tab shows the skip link, and it moves focus to the main content.
{
  const page = await browser.newPage();
  await page.goto(base + "/");
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => document.activeElement.textContent);
  if (first !== "Skip to main content") { failures++; console.log(`✗ first Tab goes to "${first}", not the skip link`); }
  await page.keyboard.press("Enter");
  if ((await page.evaluate(() => document.activeElement.id)) !== "main") { failures++; console.log("✗ the skip link doesn't move focus to the main content"); }
  // Zoom: at 320 CSS pixels wide (400% zoom on a 1280px screen), nothing scrolls sideways.
  await page.setViewportSize({ width: 320, height: 800 });
  for (const url of ["/", "/delivery/", "/week-notes/2025/42/", "/unconference/basics/", "/archive/", "/contact/"]) {
    await page.goto(base + url);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (wide > 1) { failures++; console.log(`✗ ${url} scrolls sideways at 320px wide (${wide}px)`); }
  }
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} problem(s) found.` : `\nNo problems found on ${urls.length} pages, in light and dark mode.`);
process.exit(failures ? 1 : 0);
