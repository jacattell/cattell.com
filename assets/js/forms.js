// Shows Cloudflare's "are you human" check (Turnstile) on the contact and feedback
// forms, when a site key was set at build time. Without it, the forms still work.
(() => {
  const box = document.querySelector(".human-check");
  const key = box && box.dataset.sitekey;
  if (!key) return;
  window.onHumanCheckReady = () => {
    box.hidden = false;
    window.turnstile.render(box.querySelector(".human-check-box"), { sitekey: key, theme: "auto", language: "en-gb" });
  };
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onHumanCheckReady";
  script.async = true;
  document.head.append(script);
})();
