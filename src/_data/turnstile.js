// Cloudflare Turnstile ("are you human" check) for the contact and feedback forms.
// TURNSTILE_SITE_KEY is set in Cloudflare Pages and read when the site is built.
// Without it, the forms show no check (and the server only checks if TURNSTILE_SECRET_KEY is set).
export default { siteKey: process.env.TURNSTILE_SITE_KEY || "" };
