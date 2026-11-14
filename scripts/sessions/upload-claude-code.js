#!/usr/bin/env node
// Sends Claude Code sessions to the archive on cattell.com.
//
//   node scripts/sessions/upload-claude-code.js --all            every session saved on this computer
//   node scripts/sessions/upload-claude-code.js FILE.jsonl ...   the sessions in those files
//   node scripts/sessions/upload-claude-code.js --hook           the session Claude Code has just ended
//
// With --hook, Claude Code runs this itself at the end of each session (see .claude/settings.json).
// It then never prints anything or reports a failure, so it can't get in the way of Claude Code.
// Sending a session again replaces the copy in the archive, so running this twice is safe.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseClaudeCode } from "../../lib/session-formats.js";
import { settings, upload, KEY_FILE } from "./common.js";

const args = process.argv.slice(2);
const hook = args.includes("--hook");

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

async function main() {
  const config = settings();
  if (!config.key) {
    if (hook) return;
    console.error(`No archive key. Set ARCHIVE_KEY, or save the key in ${KEY_FILE}`);
    process.exitCode = 1;
    return;
  }

  let files = args.filter((a) => !a.startsWith("--"));
  if (hook) {
    // Claude Code sends details of the session as JSON, including where its transcript is.
    const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
    files = input.transcript_path ? [input.transcript_path] : [];
  } else if (args.includes("--all")) {
    files = allTranscripts();
  }
  if (!files.length && !hook) {
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
      if (!hook) console.log(`Sent: ${session.title || session.id} (${saved} messages)`);
    } catch (err) {
      failed++;
      if (!hook) console.error(`Not sent: ${file}: ${err.message}`);
    }
  }
  if (!hook) console.log(`\n${sent} sent, ${skipped} empty and skipped, ${failed} failed.`);
  if (failed && !hook) process.exitCode = 1;
}

main().catch((err) => {
  if (!hook) { console.error(err.message); process.exitCode = 1; }
});
