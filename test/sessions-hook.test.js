// The archive hook for other repositories only runs downloaded code that matches pinned fingerprints.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { PINNED_FILES, HOOK, sha256, readPin, pin } from "../scripts/sessions/pin-hook.mjs";

const hook = fs.readFileSync(HOOK, "utf8");

test("the hook's fingerprints match the upload scripts in this repository", () => {
  const { commit, hashes } = readPin(hook);
  assert.match(commit, /^[0-9a-f]{40}$/, "pinned to a full commit, not a branch");
  for (const f of PINNED_FILES) assert.equal(hashes[f], sha256(f), `${f} changed: run node scripts/sessions/pin-hook.mjs`);
  assert.doesNotMatch(hook, /\/main"/, "doesn't download from the main branch");
});

test("the hook refuses files that don't match, and runs files that do", { skip: process.platform === "win32" }, () => {
  // Stand-ins: curl copies from a local folder; node records that it ran.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "hook-"));
  const src = path.join(work, "src");
  const bin = path.join(work, "bin");
  fs.mkdirSync(bin);
  for (const f of PINNED_FILES) {
    fs.mkdirSync(path.join(src, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(src, f), `// ${f}\n`);
  }
  const good = Object.fromEntries(PINNED_FILES.map((f) => [f, sha256(path.join(src, f))]));
  fs.writeFileSync(path.join(bin, "curl"), `#!/bin/bash\nurl=""; out=""\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -*) shift;; *) url="$1"; shift;; esac; done\ncp "${src}/\${url#*/cattell.com/*/}" "$out"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "node"), `#!/bin/bash\necho ran >> "${work}/ran"\n`, { mode: 0o755 });

  const run = (hashes) => {
    const script = path.join(work, "hook.sh");
    fs.writeFileSync(script, pin(hook, "a".repeat(40), hashes));
    fs.rmSync(path.join(work, "cache"), { recursive: true, force: true });
    return spawnSync("bash", [script], { input: "{}", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CATTELL_ARCHIVE: "1", XDG_CACHE_HOME: path.join(work, "cache") }, encoding: "utf8" });
  };

  const bad = { ...good, [PINNED_FILES[1]]: "0".repeat(64) };
  const refused = run(bad);
  assert.match(refused.stderr, /don't match their fingerprints/);
  assert.ok(!fs.existsSync(path.join(work, "ran")), "nothing ran");
  assert.ok(!fs.existsSync(path.join(work, "cache", "cattell-archive", "a".repeat(40))), "nothing was kept");

  run(good);
  assert.equal(fs.readFileSync(path.join(work, "ran"), "utf8"), "ran\n");
  fs.rmSync(work, { recursive: true, force: true });
});

test("the hook does nothing without the opt-in", () => {
  const out = execFileSync("bash", [HOOK], { input: "{}", env: { PATH: process.env.PATH, HOME: os.tmpdir() }, encoding: "utf8" });
  assert.equal(out, "");
});
