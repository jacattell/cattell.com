// Buttons in the site header: light/dark mode and text size.
// Choices are saved in this browser only (localStorage).
(function () {
  const root = document.documentElement;

  function save(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {
      // Private browsing can block storage. The buttons still work for this page.
    }
  }

  // Light/dark mode. Until the visitor chooses, the site follows their device's setting.
  // When dark mode is on, the button is "pressed" and its icon shows its negative.
  const themeButton = document.querySelector(".theme-toggle");
  if (themeButton) {
    const deviceDark = window.matchMedia("(prefers-color-scheme: dark)");
    const current = () => root.dataset.theme || (deviceDark.matches ? "dark" : "light");
    const update = () => themeButton.setAttribute("aria-pressed", String(current() === "dark"));

    themeButton.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      save("theme", next);
      update();
    });

    // If the visitor has not chosen, keep the button right when their device changes.
    deviceDark.addEventListener("change", update);
    update();
    themeButton.hidden = false;
  }

  // Text size: each press makes text 25% bigger, and the third press goes back to normal.
  const sizeButton = document.querySelector(".text-size");
  if (sizeButton) {
    const labels = ["Make text bigger", "Make text bigger", "Make text normal size"];
    const current = () => Number(root.dataset.textSize) || 0;
    const update = () => {
      const label = labels[current()];
      sizeButton.setAttribute("aria-label", label);
      sizeButton.title = label;
    };

    sizeButton.addEventListener("click", () => {
      const next = (current() + 1) % 3;
      if (next) root.dataset.textSize = String(next);
      else delete root.dataset.textSize;
      save("textSize", next ? String(next) : null);
      update();
    });

    update();
    sizeButton.hidden = false;
  }
})();
