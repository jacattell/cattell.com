// The floating "Share" panel. It works as a plain <details> element without
// JavaScript; this adds Copy link, Mastodon, the device's share menu, and
// closing with Escape or by clicking elsewhere.
(function () {
  const share = document.querySelector(".share");
  if (!share) return;
  const summary = share.querySelector("summary");
  const status = share.querySelector(".share-status");
  const url = share.dataset.url;
  const text = share.dataset.text;

  share.querySelectorAll(".js-only").forEach((el) => (el.hidden = false));

  function say(message) {
    status.textContent = message;
  }

  function close() {
    share.open = false;
    summary.focus();
  }

  share.addEventListener("toggle", () => {
    if (!share.open) say("");
  });

  share.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && share.open) {
      e.preventDefault();
      close();
    }
  });

  document.addEventListener("click", (e) => {
    if (share.open && !share.contains(e.target)) share.open = false;
  });

  // Copy link
  share.querySelector(".share-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      say("Link copied.");
    } catch {
      say("Could not copy. The link is " + url);
    }
  });

  // Mastodon: each person uses their own server, so ask for it and remember it.
  const toggle = share.querySelector(".share-mastodon-toggle");
  const form = share.querySelector(".share-mastodon");
  const input = form.querySelector("input");
  toggle.addEventListener("click", () => {
    const show = form.hidden;
    form.hidden = !show;
    toggle.setAttribute("aria-expanded", String(show));
    if (show) {
      try {
        input.value = localStorage.getItem("mastodonServer") || "";
      } catch {}
      input.focus();
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const server = input.value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(server)) {
      say("Please enter a server name, like mastodon.social.");
      input.focus();
      return;
    }
    try {
      localStorage.setItem("mastodonServer", server);
    } catch {}
    window.open("https://" + server + "/share?text=" + encodeURIComponent(text + " " + url), "_blank", "noopener");
  });

  // The device's own share menu, where the browser offers one.
  if (navigator.share) {
    share.querySelector(".share-native-item").hidden = false;
    share.querySelector(".share-native").addEventListener("click", () => {
      navigator.share({ title: text, url }).catch(() => {});
    });
  }
})();
