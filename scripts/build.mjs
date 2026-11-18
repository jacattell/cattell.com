// Builds the website into public/: prepares the archive, then runs Hugo.
// Needs Node and Hugo (the version in .hugo-version). No npm packages.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { prepare } from "./prepare.mjs";

const want = fs.readFileSync(new URL("../.hugo-version", import.meta.url), "utf8").trim();
let have = "";
try { have = execFileSync("hugo", ["version"], { encoding: "utf8" }); } catch {
  console.error(`Hugo isn't installed. Install version ${want}: https://gohugo.io/installation/`);
  process.exit(1);
}
if (!have.includes(`v${want}`)) console.warn(`Warning: this site is built with Hugo ${want}, but you have: ${have.trim()}`);

const { items, pages } = prepare();
console.log(`Archive: ${items} posts on ${pages} pages`);
fs.rmSync(new URL("../public", import.meta.url), { recursive: true, force: true });
execFileSync("hugo", ["--gc", "--minify", "--panicOnWarning"], { stdio: "inherit" });
