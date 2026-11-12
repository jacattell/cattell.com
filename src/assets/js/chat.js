// Chat page: sends the conversation to /api/chat and shows the reply as it arrives.
(function () {
  const log = document.getElementById("chat-log");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const send = document.getElementById("chat-send");
  const reset = document.getElementById("chat-reset");
  const status = document.getElementById("chat-status");
  let messages = [];
  // Identifies this conversation in the chat logs: the start time counted down
  // from 10^13 (so the newest list first) and a random part. See lib/chat.js.
  const newConversation = () => String(1e13 - Date.now()).padStart(13, "0") + "-" + Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  let conversation = newConversation();
  let busy = false;

  // Turns web and email addresses in a reply into links. Builds the page
  // elements directly (never as HTML), so a reply cannot add anything else.
  const ADDRESS = /\bhttps?:\/\/[^\s<>"]+|\bwww\.[^\s<>"]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;
  function trimEnd(address) {
    // Leave out full stops, commas and closing brackets that end a sentence.
    let end = address;
    while (/[.,;:!?'")\]]$/.test(end)) {
      if (end.endsWith(")") && (end.match(/\(/g) || []).length >= (end.match(/\)/g) || []).length) break;
      end = end.slice(0, -1);
    }
    return end;
  }
  function showWithLinks(el, text) {
    el.replaceChildren();
    let last = 0;
    for (const match of text.matchAll(ADDRESS)) {
      const address = trimEnd(match[0]);
      if (!address) continue;
      el.append(text.slice(last, match.index));
      const link = document.createElement("a");
      if (address.includes("@") && !/^https?:|^www\./i.test(address)) {
        link.href = "mailto:" + address;
      } else {
        link.href = /^www\./i.test(address) ? "https://" + address : address;
        link.target = "_blank";
        link.rel = "noopener";
      }
      link.textContent = address;
      if (link.target) {
        const note = document.createElement("span");
        note.className = "visually-hidden";
        note.textContent = " (opens in a new tab)";
        link.append(note);
      }
      el.append(link);
      last = match.index + address.length;
    }
    el.append(text.slice(last));
  }

  function addMessage(who, text, cls) {
    const p = document.createElement("p");
    p.className = "msg" + (cls ? " " + cls : "");
    const label = document.createElement("span");
    label.className = "who";
    label.textContent = who;
    const body = document.createElement("span");
    body.textContent = text;
    p.append(label, body);
    log.append(p);
    p.scrollIntoView({ block: "nearest" });
    return body;
  }

  function setBusy(value) {
    busy = value;
    send.disabled = value;
    status.textContent = value ? "Claude is replying…" : "";
  }

  async function ask(text) {
    messages.push({ role: "user", content: text });
    addMessage("You", text);
    const out = addMessage("Claude", "");
    setBusy(true);
    let reply = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, conversation }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Sorry, chat is not available right now.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();
        for (const event of events) {
          if (!event.startsWith("data: ")) continue;
          const data = JSON.parse(event.slice(6));
          if (data.text) {
            reply += data.text;
            showWithLinks(out, reply);
          }
          if (data.error) throw new Error(data.error);
        }
      }
      if (!reply) throw new Error("Sorry, no reply came back. Please try again.");
      messages.push({ role: "assistant", content: reply });
    } catch (err) {
      // Drop the unanswered question (and any partial reply) so the next attempt starts clean.
      messages.pop();
      out.parentElement.remove();
      addMessage("Problem", err.message || "Something went wrong.", "error");
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    ask(text);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  reset.addEventListener("click", () => {
    if (busy) return;
    messages = [];
    conversation = newConversation();
    log.replaceChildren();
    input.focus();
  });
})();
