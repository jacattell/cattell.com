// Chat logs (admin.cattell.com/chats/): conversations from the "Ask my AI" page, newest first.
// Behind Cloudflare Access. Data comes from workers/admin/src/chats.js.
(function () {
  const app = document.getElementById("chat-logs");
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
  const count = (n) => (n > 0 ? ` · ${n} ${n === 1 ? "question" : "questions"}` : "");
  async function api(path) {
    const res = await fetch("/api/" + path, { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 || res.redirected) throw Object.assign(new Error("signin"), { signin: true });
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  function conversationView(record) {
    return el("div", { class: "chat-record" }, ...record.turns.flatMap((t) => [
      el("p", { class: "msg" }, el("span", { class: "who" }, "Visitor"), el("span", {}, t.q)),
      el("p", { class: "msg" }, el("span", { class: "who" }, "AI"), el("span", {}, t.a)),
    ]));
  }

  function item(chat) {
    const body = el("div", { hidden: true });
    const button = el("button", { type: "button", class: "secondary", "aria-expanded": "false", onclick: async () => {
      const open = button.getAttribute("aria-expanded") === "true";
      if (open) { body.hidden = true; button.setAttribute("aria-expanded", "false"); button.textContent = "Show conversation"; return; }
      button.disabled = true;
      try {
        body.replaceChildren(conversationView(await api(`chat?id=${encodeURIComponent(chat.id)}`)));
      } catch (err) {
        body.replaceChildren(el("p", { class: "editor-problem" }, err.message));
      }
      button.disabled = false;
      body.hidden = false;
      button.setAttribute("aria-expanded", "true");
      button.textContent = "Hide conversation";
    } }, "Show conversation");
    return el("li", { class: "chat-item" },
      el("p", { class: "post-meta" }, el("time", { datetime: chat.started || "" }, when(chat.started)), count(chat.turns)),
      ...(chat.first ? [el("p", { class: "chat-first" }, chat.first)] : []),
      button, body);
  }

  async function load() {
    try {
      await api("me");
    } catch (err) {
      app.replaceChildren(el("p", {}, "Your sign-in has run out. Reload the page to sign in again."));
      return;
    }
    const list = el("ol", { class: "chat-list" });
    const more = el("button", { type: "button", class: "secondary", hidden: true });
    let cursor = null;
    async function page() {
      more.disabled = true;
      try {
        const data = await api("chats" + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""));
        data.chats.forEach((c) => list.append(item(c)));
        cursor = data.cursor;
        more.hidden = !cursor;
        if (!list.children.length) list.replaceWith(el("p", {}, "No conversations in the last 30 days."));
      } catch (err) {
        app.append(el("p", { class: "editor-problem", role: "alert" }, err.message));
      }
      more.disabled = false;
    }
    more.textContent = "Show older conversations";
    more.addEventListener("click", page);
    app.replaceChildren(
      el("p", {}, "Conversations from the ", el("a", { href: "https://www.cattell.com/chat/" }, "Ask my AI page"), ", newest first. Each one is deleted automatically 30 days after its last message."),
      list, more);
    await page();
  }
  load();
})();
