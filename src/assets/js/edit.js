// Week notes editor (/edit/). Talks to /api/edit/* (lib/editor.js), which reads
// and saves notes in the GitHub repo after signing in with GitHub.
(function () {
  const app = document.getElementById("editor-app");
  const h1 = document.querySelector("main h1");
  let dirty = false;

  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });

  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    e.append(...children);
    return e;
  };

  // The preview shows the note's HTML, so it keeps only ordinary formatting: no scripts,
  // forms, frames or styles, no event attributes, and only web, email and page links.
  const ALLOWED = new Set("a abbr b blockquote br caption code dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q s small span strong sub summary sup table tbody td tfoot th thead tr u ul".split(" "));
  const ATTRIBUTES = new Set(["href", "src", "alt", "title", "width", "height", "colspan", "rowspan", "class", "id", "lang", "cite", "datetime", "open"]);
  const DROP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "META", "LINK", "BASE", "SVG", "MATH"]);
  const safeUrl = (value) => /^(https?:|mailto:|\/|#|\.)/i.test(value.trim()) || !/^[a-z][a-z0-9+.-]*:/i.test(value.trim());
  function safeHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html"); // nothing runs in this copy
    const clean = (node) => {
      for (const child of [...node.children]) {
        if (DROP.has(child.tagName)) { child.remove(); continue; }
        clean(child);
        if (!ALLOWED.has(child.tagName.toLowerCase())) { child.replaceWith(...child.childNodes); continue; }
        for (const { name, value } of [...child.attributes]) {
          if (!ATTRIBUTES.has(name) || ((name === "href" || name === "src" || name === "cite") && !safeUrl(value))) child.removeAttribute(name);
        }
      }
    };
    const root = doc.body.firstChild;
    clean(root);
    return [...root.childNodes];
  }

  async function api(path, options = {}) {
    const res = await fetch("/api/edit/" + path, {
      ...options,
      headers: { "X-Editor": "1", ...(options.body ? { "Content-Type": "application/json" } : {}) },
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error("Please sign in again."), { signin: true });
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  function isoWeek(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
  }
  const pad = (n) => String(n).padStart(2, "0");
  const title = (path) => { const [y, w] = path.split("/"); return `Week ${Number(w)}, ${y}`; };

  function show(heading, ...children) {
    h1.textContent = heading;
    document.title = `${heading} - James Arthur Cattell`;
    app.replaceChildren(...children);
  }
  const problem = (message) => el("div", { class: "editor-problem", role: "alert" }, el("p", {}, message));

  function signOutForm(login) {
    return el("form", { method: "post", action: "/api/auth/logout", class: "editor-signout" },
      el("span", { class: "hint" }, `Signed in as ${login}. `), el("button", { type: "submit", class: "secondary" }, "Sign out"));
  }

  // ---- signed out ----
  function signInView(reason) {
    const messages = {
      setup: "The editor isn't set up yet. See \"Week notes editor\" in the README.",
      signin: "Signing in didn't work. Please try again.",
      notallowed: "That GitHub account isn't allowed to edit this website.",
    };
    show("Edit week notes",
      ...(reason && messages[reason] ? [problem(messages[reason])] : []),
      el("p", {}, "Sign in with GitHub to edit your week notes."),
      el("p", {}, el("a", { class: "editor-button", href: "/api/auth/login" }, "Sign in with GitHub")));
  }

  // ---- list ----
  async function listView(login) {
    show("Edit week notes", el("p", { class: "hint" }, "Loading your notes…"));
    let notes;
    try {
      ({ notes } = await api("notes"));
    } catch (err) {
      return err.signin ? signInView("signin") : show("Edit week notes", problem(err.message), signOutForm(login));
    }
    const now = isoWeek();
    const newForm = el("form", { class: "site-form editor-new", onsubmit: (e) => {
      e.preventDefault();
      const path = `${e.target.year.value}/${pad(e.target.week.value)}`;
      if (notes.some((n) => n.path === path)) return go({ note: path });
      go({ new: path });
    } },
      el("h2", {}, "Start a new note"),
      el("div", { class: "editor-row" },
        el("div", {}, el("label", { for: "new-year" }, "Year"), el("input", { id: "new-year", name: "year", type: "number", min: "2000", max: "2100", value: now.year, required: true, class: "editor-short" })),
        el("div", {}, el("label", { for: "new-week" }, "Week"), el("input", { id: "new-week", name: "week", type: "number", min: "1", max: "53", value: now.week, required: true, class: "editor-short" }))),
      el("button", { type: "submit" }, "Start note"));
    const byYear = {};
    notes.forEach((n) => (byYear[n.year] ??= []).push(n));
    show("Edit week notes", signOutForm(login), el("p", {}, el("a", { href: "/edit/chats/" }, "Read the chat logs")), newForm,
      el("h2", {}, "Your notes"),
      ...Object.keys(byYear).sort((a, b) => b - a).flatMap((y) => [
        el("h3", {}, y),
        el("ul", { class: "editor-list" }, ...byYear[y].map((n) => el("li", {}, el("a", { href: `?note=${n.path}` }, `Week ${n.week}`)))),
      ]));
  }

  // ---- editor ----
  async function editView(login, path, isNew) {
    show(`${isNew ? "New note" : "Edit"}: ${title(path)}`, el("p", { class: "hint" }, "Loading…"));
    let note = { path, summary: "", other: [], body: "", sha: null };
    if (!isNew) {
      try { note = await api(`note?path=${encodeURIComponent(path)}`); }
      catch (err) { return err.signin ? signInView("signin") : show(title(path), problem(err.message), el("p", {}, el("a", { href: "?" }, "Back to your notes"))); }
    } else {
      note.body = `- covers …\n\n## \n\n`;
    }
    const status = el("div", { class: "editor-status", role: "status" });
    const preview = el("div", { class: "editor-preview", hidden: true });
    const form = el("form", { class: "site-form" },
      el("label", { for: "summary" }, "Summary ", el("span", { class: "hint" }, "(optional, shown on the week notes list)")),
      el("input", { id: "summary", name: "summary", type: "text", value: note.summary, maxlength: "300" }),
      el("label", { for: "body" }, "Note ", el("span", { class: "hint" }, "(Markdown; the title is added for you)")),
      el("textarea", { id: "body", name: "body", rows: "22", class: "editor-body", spellcheck: "true" }, note.body),
      el("label", { for: "message" }, "Change description ", el("span", { class: "hint" }, "(optional, saved in GitHub's history)")),
      el("input", { id: "message", name: "message", type: "text", maxlength: "200", placeholder: `${isNew ? "Add" : "Update"} week note: ${title(path).toLowerCase()}` }),
      el("div", { class: "editor-actions" },
        el("button", { type: "submit" }, "Save and publish"),
        el("button", { type: "button", class: "secondary", onclick: async () => {
          try {
            const { html } = await api("preview", { method: "POST", body: JSON.stringify({ body: form.body.value }) });
            preview.replaceChildren(el("h2", { class: "hint" }, "Preview"), el("h1", {}, title(path)), ...safeHtml(html));
            preview.hidden = false;
            preview.scrollIntoView({ behavior: "smooth", block: "start" });
          } catch (err) { status.replaceChildren(problem(err.message)); }
        } }, "Preview"),
        el("a", { href: "?", onclick: (e) => { if (dirty && !confirm("Leave without saving your changes?")) e.preventDefault(); else dirty = false; } }, "Back to your notes")),
      status);
    form.addEventListener("input", () => { dirty = true; });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      status.replaceChildren(el("p", { class: "hint" }, "Saving…"));
      try {
        const saved = await api("note", { method: "PUT", body: JSON.stringify({ path, summary: form.summary.value, body: form.body.value, other: note.other, sha: note.sha, message: form.message.value }) });
        note.sha = saved.sha;
        dirty = false;
        if (isNew) { history.replaceState(null, "", `?note=${path}`); isNew = false; h1.textContent = `Edit: ${title(path)}`; }
        form.message.value = "";
        status.replaceChildren(el("div", { class: "editor-saved" },
          el("p", {}, "Saved. The website will update in about a minute: ", el("a", { href: saved.url }, `view ${title(path)}`), "."),
          ...(saved.commit ? [el("p", { class: "hint" }, el("a", { href: saved.commit }, "See the change on GitHub"))] : [])));
      } catch (err) {
        status.replaceChildren(problem(err.message));
      } finally {
        button.disabled = false;
      }
    });
    show(`${isNew ? "New note" : "Edit"}: ${title(path)}`, signOutForm(login), form, preview);
  }

  function go(params) {
    const q = new URLSearchParams(params).toString();
    history.pushState(null, "", q ? `?${q}` : location.pathname);
    route();
  }
  window.addEventListener("popstate", route);

  let login;
  async function route() {
    const params = new URLSearchParams(location.search);
    if (!login) {
      try {
        ({ login } = await api("me"));
      } catch (err) {
        return signInView(params.get("problem") || (err.signin ? null : "setup"));
      }
    }
    const note = params.get("note"), fresh = params.get("new");
    if (note && /^\d{4}\/\d{2}$/.test(note)) return editView(login, note, false);
    if (fresh && /^\d{4}\/\d{2}$/.test(fresh)) return editView(login, fresh, true);
    return listView(login);
  }
  route();
})();
