// Shared by the scripts that send Claude sessions to the archive on admin.cattell.com.
// See "Claude sessions archive" in the README.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadParts } from "../../lib/session-formats.js";

export const KEY_FILE = path.join(os.homedir(), ".config", "cattell-archive", "key");

/**
 * The archive's address. The key is sent with every upload, so the address must be an
 * encrypted one (https://). Plain http:// is only allowed to this computer, for testing.
 */
export function archiveUrl(given) {
  let url;
  try { url = new URL(given || "https://admin.cattell.com"); } catch { throw new Error("ARCHIVE_URL isn't a web address."); }
  const thisComputer = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !thisComputer) throw new Error("ARCHIVE_URL must start with https://, so the archive key is never sent unprotected.");
  return url.origin;
}

/** The archive's address and key: from ARCHIVE_URL and ARCHIVE_KEY, or the key file. */
export function settings() {
  let key = process.env.ARCHIVE_KEY || "";
  if (!key) {
    try { key = fs.readFileSync(KEY_FILE, "utf8").trim(); } catch { /* no key file */ }
  }
  return { url: archiveUrl(process.env.ARCHIVE_URL), key };
}

/**
 * Sends one session, in parts if it is long. Returns the number of messages saved.
 * `start` sends only the messages from there on. With no key, the request goes without
 * one: in a cloud session, the environment's network secret adds it on the way out.
 */
export async function upload(session, { url, key }, send = fetch, start = 0) {
  let saved = 0;
  for (const part of uploadParts(session, undefined, start)) {
    const res = await send(`${url}/api/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
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
