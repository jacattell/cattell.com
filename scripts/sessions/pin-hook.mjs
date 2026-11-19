// Pins the archive hook for other repositories (scripts/sessions/for-other-repos/cattell-archive.sh)
// to the latest commit that changed the upload scripts, with each file's SHA-256 fingerprint.
// Run after changing any of the files below and committing them:
//   node scripts/sessions/pin-hook.mjs
// then commit the hook, and copy it into each repository's .claude/hooks/ folder.
// A test (test/sessions-hook.test.js) fails if the fingerprints no longer match the files.
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export const PINNED_FILES = ["lib/session-formats.js", "scripts/sessions/common.js", "scripts/sessions/upload-claude-code.js"];
export const HOOK = "scripts/sessions/for-other-repos/cattell-archive.sh";

export const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Writes the commit and fingerprints into the hook's pinned part. */
export function pin(hookText, commit, hashes) {
  const lines = PINNED_FILES.map((f) => `  "${f} ${hashes[f]}"`).join("\n");
  return hookText.replace(
    /# --- pinned by scripts\/sessions\/pin-hook\.mjs ---[\s\S]*?# --- end of pinned part ---/,
    `# --- pinned by scripts/sessions/pin-hook.mjs ---\ncommit="${commit}"\nfiles=(\n${lines}\n)\n# --- end of pinned part ---`,
  );
}

/** Reads the commit and fingerprints back out of the hook. */
export function readPin(hookText) {
  const commit = /^commit="([^"]*)"$/m.exec(hookText)?.[1];
  const hashes = Object.fromEntries([...hookText.matchAll(/^  "([^ "]+) ([0-9a-f]{64}|[A-Z_]+)"$/gm)].map((m) => [m[1], m[2]]));
  return { commit, hashes };
}

if (process.argv[1] && import.meta.url.endsWith("pin-hook.mjs")) {
  const dirty = execFileSync("git", ["status", "--porcelain", "--", ...PINNED_FILES], { encoding: "utf8" }).trim();
  if (dirty) {
    console.error("Commit your changes to the upload scripts first, so the pinned commit contains them.");
    process.exit(1);
  }
  const commit = execFileSync("git", ["log", "-1", "--format=%H", "--", ...PINNED_FILES], { encoding: "utf8" }).trim();
  const hashes = Object.fromEntries(PINNED_FILES.map((f) => [f, sha256(f)]));
  fs.writeFileSync(HOOK, pin(fs.readFileSync(HOOK, "utf8"), commit, hashes));
  console.log(`Pinned ${HOOK} to ${commit}. Push that commit, then copy the hook into your other repositories.`);
}
