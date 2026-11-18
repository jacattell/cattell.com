// Claude sessions archive (admin.cattell.com/sessions/): search and read saved prompts and answers,
// with Claude's thinking, tool calls and tool results folded up beside them.
// Behind Cloudflare Access. Data comes from workers/admin/src/sessions.js.
(function () {
  const app = document.getElementById("sessions");
  const SOURCES = { code: "Claude Code", chat: "Claude chat" };
  /** Who or what a message is from, for example "Tool result: Bash". */
  const label = (m) => ({ prompt: "James", answer: "Claude", thinking: "Claude's thinking", tool: "Tool call", result: "Tool result", file: "Attached file" }[m.kind] || "Message") + (m.tool ? `: ${m.tool}` : "");
  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    e.append(...children);
    return e;
  };
  const when = (iso) => {
    const d = iso ? new Date(iso) : null;
    return !d || isNaN(d) ? "Unknown time" : d.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  };
  const plural = (n, word) => `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;
  async function api(path, init = {}) {
    const res = await fetch("/api/" + path, { credentials: "same-origin", ...init, headers: init.method ? { "X-Admin": "1" } : {} });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 || res.redirected) throw Object.assign(new Error("Please sign in again."), { signin: true });
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  const problem = (err) => el("p", { class: "editor-problem", role: "alert" }, err.message);

  /** A search result's text, with the words that were found highlighted. */
  function highlighted(snippet) {
    const out = el("span", {});
    String(snippet).split("\u0001").forEach((piece, i) => {
      if (i === 0) return out.append(piece);
      const [found, rest = ""] = piece.split("\u0002");
      out.append(el("mark", {}, found), rest);
    });
    return out;
  }

  // ---------- one session ----------
  /**
   * Prompts and answers are shown in full. Thinking, tool calls and tool results are
   * folded up; a long one is fetched in full the first time it is opened.
   */
  function messageView(id, m) {
    if (m.kind === "prompt" || m.kind === "answer") {
      return el("p", { class: "msg", id: `m${m.n}`, tabindex: "-1" }, el("span", { class: "who" }, label(m)), el("span", {}, m.text));
    }
    const text = el("pre", { class: "session-extra-text" }, m.text + (m.length > m.text.length ? "…" : ""));
    const details = el("details", { class: "session-extra", id: `m${m.n}` }, el("summary", {}, label(m)), text);
    let whole = m.length <= m.text.length;
    details.addEventListener("toggle", async () => {
      if (!details.open || whole) return;
      whole = true;
      try {
        text.textContent = (await api(`message?id=${encodeURIComponent(id)}&n=${m.n}`)).text;
      } catch (err) {
        whole = false;
        text.textContent = m.text + "…\n\n" + err.message;
      }
    });
    return details;
  }

  async function showSession(id, jumpTo) {
    const list = el("div", { class: "chat-record" });
    const more = el("button", { type: "button", class: "secondary", hidden: true }, "Show more of this session");
    const heading = el("h2", {}, "Loading…");
    const about = el("p", { class: "post-meta" });
    const status = el("div", {});
    let next = 0;

    async function page() {
      more.disabled = true;
      try {
        const data = await api(`session?id=${encodeURIComponent(id)}&from=${next}`);
        heading.textContent = data.session.title || "Untitled session";
        about.textContent = [SOURCES[data.session.source], data.session.project, when(data.session.started), plural(data.session.messages, "message")].filter(Boolean).join(" · ");
        for (const m of data.messages) list.append(messageView(id, m));
        next = data.next;
        more.hidden = next === null;
      } catch (err) {
        status.replaceChildren(problem(err));
      }
      more.disabled = false;
    }
    more.addEventListener("click", page);

    // Deleting asks twice, on the page, before anything is removed.
    const remove = el("button", { type: "button", class: "secondary", onclick: async () => {
      if (remove.dataset.sure !== "1") {
        remove.dataset.sure = "1";
        remove.textContent = "Yes, delete this session from the archive";
        return;
      }
      remove.disabled = true;
      try {
        await api(`session?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        location.hash = "";
      } catch (err) {
        status.replaceChildren(problem(err));
        remove.disabled = false;
      }
    } }, "Delete this session");

    app.replaceChildren(el("p", {}, el("a", { href: "#" }, "Back to all sessions")), heading, about, status, list, more, el("p", {}, remove));
    await page();
    // Load on until the message from the search result is on the page, then go to it.
    while (jumpTo != null && next !== null && next <= jumpTo) await page();
    const target = jumpTo != null && document.getElementById(`m${jumpTo}`);
    if (target) {
      if (target.tagName === "DETAILS") target.open = true;
      target.scrollIntoView();
      (target.querySelector("summary") || target).focus();
    }
  }

  // ---------- the list and search ----------
  async function showList() {
    const q = el("input", { id: "sessions-q", type: "search", autocomplete: "off" });
    const sources = Object.entries(SOURCES).map(([value, name]) => el("label", {}, el("input", { type: "radio", name: "source", value }), " " + name));
    const form = el("form", { class: "archive-search", role: "search" },
      el("label", { for: "sessions-q" }, "Search prompts and answers"), q,
      el("fieldset", {}, el("legend", { class: "visually-hidden" }, "Where from"),
        el("label", {}, el("input", { type: "radio", name: "source", value: "", checked: true }), " Everything"), ...sources),
      el("fieldset", {}, el("label", {}, el("input", { type: "checkbox", name: "talk" }), " Only search prompts and answers")),
      el("p", {}, el("button", { type: "submit" }, "Search")));
    const summary = el("p", { class: "hint" });
    const list = el("ol", { class: "chat-list" });
    const more = el("button", { type: "button", class: "secondary", hidden: true }, "Show more");
    const status = el("div", {});
    let next = 0;

    const link = (id, n) => "#" + encodeURIComponent(id) + (n == null ? "" : `/${n}`);
    const sessionItem = (s) => el("li", { class: "chat-item" },
      el("p", { class: "post-meta" }, [SOURCES[s.source], s.project, when(s.updated || s.started), plural(s.messages, "message")].filter(Boolean).join(" · ")),
      el("p", { class: "chat-first" }, el("a", { href: link(s.id) }, s.title || "Untitled session")));
    const resultItem = (r) => el("li", { class: "chat-item" },
      el("p", { class: "post-meta" }, [SOURCES[r.source], when(r.at), label(r)].filter(Boolean).join(" · ")),
      el("p", { class: "chat-first" }, el("a", { href: link(r.id, r.n) }, r.title || "Untitled session")),
      el("p", {}, highlighted(r.snippet)));

    async function page(fresh) {
      if (fresh) { next = 0; list.replaceChildren(); }
      more.disabled = true;
      status.replaceChildren();
      const source = form.elements.source.value;
      const params = new URLSearchParams({ from: String(next) });
      if (q.value.trim()) params.set("q", q.value.trim());
      if (source) params.set("source", source);
      if (form.elements.talk.checked) params.set("only", "talk");
      try {
        const data = await api("sessions?" + params);
        if (data.results) {
          data.results.forEach((r) => list.append(resultItem(r)));
          summary.textContent = list.children.length ? "Newest first. Every word you type must be in the message." : "Nothing found.";
        } else {
          data.sessions.forEach((s) => list.append(sessionItem(s)));
          summary.textContent = data.total.sessions
            ? `${plural(data.total.sessions, "session")} and ${plural(data.total.messages, "message")} saved. Newest first.`
            : "No sessions have been saved yet.";
        }
        next = data.next;
        more.hidden = next === null;
      } catch (err) {
        status.replaceChildren(problem(err));
      }
      more.disabled = false;
    }
    form.addEventListener("submit", (e) => { e.preventDefault(); page(true); });
    form.addEventListener("change", (e) => { if (e.target.name === "source" || e.target.name === "talk") page(true); });
    more.addEventListener("click", () => page(false));

    app.replaceChildren(
      el("p", {}, "Your prompts and Claude's answers, with Claude's thinking, tool calls and tool results, from Claude Code and Claude chats. Only you can see this page."),
      el("p", {}, el("a", { href: "/" }, "Back to the week notes editor")),
      form, summary, status, list, more);
    await page(true);
  }

  // The address after # says what to show: nothing for the list, or a session and a message number.
  async function route() {
    const [id, n] = decodeURIComponent(location.hash.slice(1)).split("/");
    try {
      await api("me");
    } catch (err) {
      app.replaceChildren(el("p", {}, "Your sign-in has run out. Reload the page to sign in again."));
      return;
    }
    if (id) await showSession(id, n === undefined ? null : Number(n));
    else await showList();
  }
  window.addEventListener("hashchange", route);
  route();
})();
