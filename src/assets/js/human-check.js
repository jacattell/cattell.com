// Shows the Cloudflare Turnstile "are you human" check on the contact and feedback
// forms, if it is set up. The site key comes from /api/form-config.
(function () {
  const boxes = document.querySelectorAll("[data-human-check]");
  if (!boxes.length) return;
  fetch("/api/form-config", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : {}))
    .then(({ turnstileSiteKey }) => {
      if (!turnstileSiteKey) return;
      window.onHumanCheckReady = () => {
        boxes.forEach((box) => {
          box.hidden = false;
          window.turnstile.render(box, { sitekey: turnstileSiteKey, theme: "auto", language: "en-gb" });
        });
      };
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onHumanCheckReady";
      script.async = true;
      document.head.append(script);
    })
    .catch(() => {});
})();
