#!/usr/bin/env node
// Sends chats from a claude.ai data export to the archive on cattell.com.
//
//   node scripts/sessions/import-claude-export.js FOLDER
//
// FOLDER is the unzipped export (it holds conversations.json). You can give the
// conversations.json file itself instead. Sending a chat again replaces the copy
// in the archive, so importing a newer export later is safe.
import fs from "node:fs";
import path from "node:path";
import { parseClaudeExport } from "../../lib/session-formats.js";
import { settings, upload, KEY_FILE } from "./common.js";

async function main() {
  const given = process.argv[2];
  if (!given) throw new Error("Give the folder of the unzipped export, or its conversations.json file.");
  const file = fs.statSync(given).isDirectory() ? path.join(given, "conversations.json") : given;
  const config = settings();
  if (!config.key) throw new Error(`No archive key. Set ARCHIVE_KEY, or save the key in ${KEY_FILE}`);

  const chats = parseClaudeExport(JSON.parse(fs.readFileSync(file, "utf8")));
  let sent = 0, failed = 0;
  for (const chat of chats) {
    try {
      const saved = await upload(chat, config);
      sent++;
      console.log(`Sent: ${chat.title || chat.id} (${saved} messages)`);
    } catch (err) {
      failed++;
      console.error(`Not sent: ${chat.title || chat.id}: ${err.message}`);
    }
  }
  console.log(`\n${sent} sent, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
