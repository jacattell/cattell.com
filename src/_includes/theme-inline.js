// Apply a saved light/dark choice before the page is drawn, so it does not flash.
try { var t = localStorage.getItem("theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) {}
