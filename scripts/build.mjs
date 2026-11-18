// Builds the website into public/: prepares the archive, then runs Hugo.
// Needs Node only. If the Hugo version in .hugo-version isn't installed, it is
// downloaded from Hugo's GitHub releases and checked against the published
// checksums first (on Linux and macOS). No npm packages.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { prepare } from "./prepare.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const want = fs.readFileSync(path.join(root, ".hugo-version"), "utf8").trim();

function installed(cmd) {
  try { return execFileSync(cmd, ["version"], { encoding: "utf8" }).includes(`v${want}`); } catch { return false; }
}

async function download() {
  const platform = { linux: "linux", darwin: "darwin" }[process.platform];
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  if (!platform || !arch) throw new Error(`Install Hugo ${want} yourself: https://gohugo.io/installation/`);
  const file = platform === "darwin" ? `hugo_${want}_darwin-universal.tar.gz` : `hugo_${want}_linux-${arch}.tar.gz`;
  const base = `https://github.com/gohugoio/hugo/releases/download/v${want}`;
  const dir = path.join(os.tmpdir(), `hugo-${want}`);
  const bin = path.join(dir, "hugo");
  if (fs.existsSync(bin) && installed(bin)) return bin;
  console.log(`Downloading Hugo ${want}…`);
  const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} for ${url}`); return Buffer.from(await r.arrayBuffer()); };
  const [archive, sums] = await Promise.all([get(`${base}/${file}`), get(`${base}/hugo_${want}_checksums.txt`)]);
  const expected = sums.toString().split("\n").find((l) => l.trim().endsWith(` ${file}`))?.split(/\s+/)[0];
  const actual = crypto.createHash("sha256").update(archive).digest("hex");
  if (!expected || expected !== actual) throw new Error(`Hugo download didn't match its checksum (${file}).`);
  fs.mkdirSync(dir, { recursive: true });
  const tgz = path.join(dir, file);
  fs.writeFileSync(tgz, archive);
  execFileSync("tar", ["-xzf", tgz, "-C", dir, "hugo"]);
  return bin;
}

const hugo = installed("hugo") ? "hugo" : await download();
const { items, pages } = prepare();
console.log(`Archive: ${items} posts on ${pages} pages`);
fs.rmSync(path.join(root, "public"), { recursive: true, force: true });
execFileSync(hugo, ["--gc", "--minify", "--panicOnWarning"], { stdio: "inherit", cwd: root });
