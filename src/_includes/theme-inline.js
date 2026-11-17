// Apply a saved light/dark and text size choice before the page is drawn, so it does not flash.
try { var t = localStorage.getItem("theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; var z = localStorage.getItem("textSize"); if (z === "1" || z === "2") document.documentElement.dataset.textSize = z; } catch (e) {}
