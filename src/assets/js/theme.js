// Light/dark mode switch in the site header.
// Until the visitor chooses, the site follows their device's setting.
// Their choice is saved in this browser only (localStorage).
(function () {
  const button = document.querySelector(".theme-toggle");
  if (!button) return;
  const root = document.documentElement;
  const deviceDark = window.matchMedia("(prefers-color-scheme: dark)");

  function current() {
    return root.dataset.theme || (deviceDark.matches ? "dark" : "light");
  }

  function update() {
    const dark = current() === "dark";
    button.textContent = dark ? "Light mode" : "Dark mode";
    button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }

  button.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch (e) {
      // Private browsing can block storage. The switch still works for this page.
    }
    update();
  });

  // If the visitor has not chosen, keep the label right when their device changes.
  deviceDark.addEventListener("change", update);

  update();
  button.hidden = false;
})();
