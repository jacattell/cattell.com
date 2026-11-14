// Shared by the scripts that send Claude sessions to the archive on cattell.com.
// See "Claude sessions archive" in the README.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadParts } from "../../lib/session-formats.js";

export const KEY_FILE = path.join(os.homedir(), ".config", "cattell-archive", "key");

/** The archive's address and key: from ARCHIVE_URL and ARCHIVE_KEY, or the key file. */
export function settings() {
  let key = process.env.ARCHIVE_KEY || "";
  if (!key) {
    try { key = fs.readFileSync(KEY_FILE, "utf8").trim(); } catch { /* no key file */ }
  }
  return { url: (process.env.ARCHIVE_URL || "https://www.cattell.com").replace(/\/+$/, ""), key };
}

/** Sends one session, in parts if it is long. Returns the number of messages saved. */
export async function upload(session, { url, key }, send = fetch) {
  let saved = 0;
  for (const part of uploadParts(session)) {
    const res = await send(`${url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(part),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `The archive answered ${res.status}.`);
    }
    saved = (await res.json()).messages;
  }
  return saved;
}
