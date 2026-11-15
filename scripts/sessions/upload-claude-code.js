#!/usr/bin/env node
// Sends Claude Code sessions to the archive on cattell.com.
//
//   node scripts/sessions/upload-claude-code.js --all            every session saved on this computer
//   node scripts/sessions/upload-claude-code.js FILE.jsonl ...   the sessions in those files
//   node scripts/sessions/upload-claude-code.js --hook           the session Claude Code is running
//
// With --hook, Claude Code runs this itself after each reply and when a session ends
// (see .claude/settings.json). It then sends only what is new since last time, never
// prints anything and never reports a failure, so it can't get in the way of Claude Code.
//
// In a cloud session (CLAUDE_CODE_REMOTE=true) the hook only sends when the environment
// has CATTELL_ARCHIVE=1, which only James's environments have. The key is then added by
// the environment's network secret, so it never enters the session.
//
// Sending a session again replaces the copy in the archive, so running this twice is safe.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseClaudeCode } from "../../lib/session-formats.js";
import { settings, upload, KEY_FILE } from "./common.js";

const args = process.argv.slice(2);
const hook = args.includes("--hook");
const cloud = process.env.CLAUDE_CODE_REMOTE === "true";
const STATE_DIR = path.join(os.homedir(), ".cache", "cattell-archive");

/** Every transcript Claude Code keeps on this computer: one .jsonl file per session. */
function allTranscripts() {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
  const files = [];
  for (const project of fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : []) {
    if (!project.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(root, project.name))) if (f.endsWith(".jsonl")) files.push(path.join(root, project.name, f));
  }
  return files;
}

// ---------- the hook: send what is new ----------
const stateFile = (id) => path.join(STATE_DIR, `${id.replace(/[^\w-]/g, "_")}.json`);
const sentBefore = (id) => {
  try { return JSON.parse(fs.readFileSync(stateFile(id), "utf8")).sent || 0; } catch { return 0; }
};

/** Runs `work` unless another copy of the hook is already sending; that copy, or the next reply, catches up. */
async function alone(work) {
  const lock = path.join(STATE_DIR, "sending.lock");
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs > 10 * 60_000) fs.rmSync(lock, { recursive: true, force: true }); // left by a copy that was stopped
  } catch { /* no lock */ }
  try { fs.mkdirSync(lock); } catch { return; }
  try { await work(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

async function runHook(config) {
  if (cloud ? process.env.CATTELL_ARCHIVE !== "1" : !config.key) return;
  const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  const file = input.transcript_path;
  if (!file || !fs.existsSync(file)) return;
  // Claude Code may still be writing the reply that has just finished.
  if (input.hook_event_name === "Stop") await new Promise((done) => setTimeout(done, 3000));
  await alone(async () => {
    const session = parseClaudeCode(fs.readFileSync(file, "utf8"), path.basename(file, ".jsonl"));
    if (!session.messages.length) return;
    // Resend the last message sent before, because Claude may have added to that answer since.
    const start = Math.max(0, Math.min(sentBefore(session.id), session.messages.length) - 1);
    const saved = await upload(session, config, fetch, start);
    fs.writeFileSync(stateFile(session.id), JSON.stringify({ sent: saved }));
  });
}

// ---------- by hand ----------
async function main() {
  const config = settings();
  if (hook) return runHook(config);
  if (!config.key) {
    console.error(`No archive key. Set ARCHIVE_KEY, or save the key in ${KEY_FILE}`);
    process.exitCode = 1;
    return;
  }

  let files = args.filter((a) => !a.startsWith("--"));
  if (args.includes("--all")) {
    files = allTranscripts();
    if (!files.length) {
      console.log("No Claude Code sessions are saved on this computer, so there is nothing to send.");
      return;
    }
  }
  if (!files.length) {
    console.error("Nothing to send. Use --all, or give one or more .jsonl files.");
    process.exitCode = 1;
    return;
  }

  let sent = 0, skipped = 0, failed = 0;
  for (const file of files) {
    try {
      const session = parseClaudeCode(fs.readFileSync(file, "utf8"), path.basename(file, ".jsonl"));
      if (!session.messages.length) { skipped++; continue; }
      const saved = await upload(session, config);
      sent++;
      console.log(`Sent: ${session.title || session.id} (${saved} messages)`);
    } catch (err) {
      failed++;
      console.error(`Not sent: ${file}: ${err.message}`);
    }
  }
  console.log(`\n${sent} sent, ${skipped} empty and skipped, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  if (!hook) { console.error(err.message); process.exitCode = 1; }
});
