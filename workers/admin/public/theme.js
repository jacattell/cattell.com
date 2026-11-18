// The "Dark mode" button. Without JavaScript the site follows the device's setting.
(() => {
  const button = document.querySelector(".theme-toggle");
  if (!button) return;
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : media.matches);
  const show = () => button.setAttribute("aria-pressed", String(isDark()));
  button.hidden = false;
  show();
  button.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
    show();
  });
  media.addEventListener("change", show);

  // "Share this page": uses the device's share menu if there is one, otherwise copies the link.
  const share = document.querySelector(".share-button");
  if (share) {
    const status = document.querySelector(".share-status");
    share.hidden = false;
    share.addEventListener("click", async () => {
      const data = { title: document.title, url: location.href };
      try {
        if (navigator.share) return await navigator.share(data);
        await navigator.clipboard.writeText(location.href);
        status.textContent = "Link copied.";
      } catch (e) {
        if (e && e.name === "AbortError") return;
        status.textContent = "Could not copy the link. You can copy it from the address bar.";
      }
    });
  }
})();
