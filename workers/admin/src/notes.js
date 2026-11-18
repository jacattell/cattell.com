// Week notes: reading and saving content/week-notes/YEAR/WEEK.md in the GitHub repo.
import { github } from "./github.js";
import { json } from "../../shared/http.js";
import { renderMarkdown } from "./markdown.js";

const NOTES_DIR = "content/week-notes";
const BRANCH = "main";
export const NOTE_PATH = /^(\d{4})\/([1-9]|[1-4]\d|5[0-3])$/;

export const utf8ToBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
export const base64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

/** Monday of an ISO week, as YYYY-MM-DD. */
export function isoWeekStart(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

/**
 * Other front matter lines are sent back as they were read. Each must stay one line,
 * must not end the front matter block, and must not set title or date (worked out from the path).
 */
export const safeFrontMatterLine = (line) =>
  typeof line === "string" && !/[\r\n]/.test(line) && line.trim() !== "---" && line.length <= 500 && !/^(title|date|summary)\s*:/.test(line);

/** Splits a note file into its summary, any other front matter lines, and the Markdown body. */
export function parseNote(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { summary: "", other: [], body: text };
  let summary = "";
  const other = [];
  for (const line of m[1].split(/\r?\n/)) {
    const s = /^summary:\s*(.*)$/.exec(line);
    if (s) {
      try { summary = s[1].startsWith('"') ? JSON.parse(s[1]) : s[1]; } catch { summary = s[1]; }
    } else if (line.trim() && !/^(title|date)\s*:/.test(line)) other.push(line);
  }
  return { summary, other, body: m[2].replace(/^\n/, "") };
}

/** Builds a note file in the site's format. Title and date come from the year and week. */
export function buildNote({ year, week, summary, other = [], body }) {
  const front = [`title: ${JSON.stringify(`Week ${week}, ${year}`)}`, `date: ${JSON.stringify(isoWeekStart(year, week))}`];
  if (summary) front.push(`summary: ${JSON.stringify(summary)}`);
  front.push(...other);
  const text = body.replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n";
  return `---\n${front.join("\n")}\n---\n\n${text}`;
}

/** A new year needs its own list page (content/week-notes/YEAR/_index.md). */
const yearIndex = (year) => `---\ntitle: "Week notes ${year}"\n---\n`;

/** Handles /api/notes, /api/note and /api/preview. */
export async function handleNotes(action, request, env, send = fetch) {
  const url = new URL(request.url);
  const gh = github(env, send);
  const repo = env.REPO;

  if (action === "notes" && request.method === "GET") {
    const tree = await gh(`/repos/${repo}/git/trees/${BRANCH}?recursive=1`);
    if (!tree.ok) return json(502, { error: "Could not read the notes from GitHub." });
    const notes = tree.data.tree
      .map((t) => new RegExp(`^${NOTES_DIR}/(\\d{4})/(\\d{1,2})\\.md$`).exec(t.path))
      .filter(Boolean)
      .map((m) => ({ path: `${m[1]}/${Number(m[2])}`, year: Number(m[1]), week: Number(m[2]) }))
      .sort((a, b) => b.year - a.year || b.week - a.week);
    return json(200, { notes });
  }

  if (action === "note" && request.method === "GET") {
    const path = url.searchParams.get("path") || "";
    if (!NOTE_PATH.test(path)) return json(400, { error: "That isn't a week note." });
    const file = await gh(`/repos/${repo}/contents/${NOTES_DIR}/${path}.md?ref=${BRANCH}`);
    if (file.status === 404) return json(404, { error: "That week note doesn't exist yet." });
    if (!file.ok) return json(502, { error: "Could not read the note from GitHub." });
    return json(200, { path, sha: file.data.sha, ...parseNote(base64ToUtf8(file.data.content)) });
  }

  if (action === "note" && request.method === "PUT") {
    const input = await request.json().catch(() => null);
    if (!input || !NOTE_PATH.test(input.path || "")) return json(400, { error: "That isn't a week note. Week numbers go from 1 to 53." });
    const [, year, week] = NOTE_PATH.exec(input.path).map(Number);
    if (typeof input.body !== "string" || !input.body.trim()) return json(400, { error: "The note is empty." });
    if (input.body.length > 200_000) return json(400, { error: "The note is too long." });
    const other = input.other ?? [];
    if (!Array.isArray(other) || other.length > 20 || !other.every(safeFrontMatterLine)) return json(400, { error: "The note's settings were not in the right format." });
    const summary = String(input.summary || "").replace(/\s+/g, " ").trim().slice(0, 300);
    const content = buildNote({ year, week, summary, other, body: input.body });
    const message = String(input.message || "").replace(/\s+/g, " ").trim().slice(0, 200) || `${input.sha ? "Update" : "Add"} week note: week ${week}, ${year}`;

    if (!input.sha) {
      // First note of a new year: add the year's list page too.
      const index = await gh(`/repos/${repo}/contents/${NOTES_DIR}/${year}/_index.md?ref=${BRANCH}`);
      if (index.status === 404) {
        await gh(`/repos/${repo}/contents/${NOTES_DIR}/${year}/_index.md`, { method: "PUT", body: JSON.stringify({ message: `Add week notes page for ${year}`, content: utf8ToBase64(yearIndex(year)), branch: BRANCH }) });
      }
    }
    const saved = await gh(`/repos/${repo}/contents/${NOTES_DIR}/${year}/${week}.md`, {
      method: "PUT",
      body: JSON.stringify({ message, content: utf8ToBase64(content), branch: BRANCH, ...(input.sha ? { sha: String(input.sha) } : {}) }),
    });
    if (saved.status === 409 || saved.status === 422) {
      return json(409, { error: input.sha ? "This note was changed somewhere else since you opened it. Copy your text, reload the note, and try again." : "A note for that week already exists. Open it from the list instead." });
    }
    if (!saved.ok) return json(502, { error: "GitHub didn't accept the change. Please try again." });
    return json(200, { sha: saved.data.content?.sha, commit: saved.data.commit?.html_url, url: `${env.SITE || "https://www.cattell.com"}/week-notes/${year}/${week}/` });
  }

  if (action === "preview" && request.method === "POST") {
    const input = await request.json().catch(() => ({}));
    return json(200, { html: renderMarkdown(String(input.body || "").slice(0, 200_000)) });
  }
  return json(404, { error: "Not found." });
}
