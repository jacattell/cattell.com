// The contact and feedback forms: POST https://api.cattell.com/form
// Each answer is emailed to James through Resend (https://resend.com); nothing is stored.
// Spam protection: a hidden trap field, 5 forms per visitor per hour, and the
// Cloudflare Turnstile "are you human" check when TURNSTILE_SECRET_KEY is set
// (the public site key is set when the website is built: HUGO_PARAMS_TURNSTILESITEKEY).
import { readForm } from "../../shared/body.js";
import { RateLimiter, limited, problemPage as page } from "../../shared/http.js";

// The places listed on the feedback form. Keep in step with data/forms.yaml (a test checks).
export const WORKED_ON = ["UKGovCamp", "OneTeamGov"];

export const FORMS = {
  contact: {
    subject: "Message from the cattell.com contact form",
    page: "/contact/",
    thanks: "/contact/thanks/",
    fields: [
      { name: "message", label: "How can I help?", required: true, max: 5000 },
      { name: "email", label: "Email address", required: true, max: 254, email: true },
    ],
  },
  feedback: {
    subject: "Feedback from cattell.com",
    page: "/feedback/",
    thanks: "/feedback/thanks/",
    fields: [
      { name: "where", label: "Where we worked together", required: true, max: 200 },
      { name: "where_other", label: "Somewhere else", max: 200 },
      { name: "feedback", label: "What to stop, start or continue", required: true, max: 5000 },
      { name: "name", label: "Name", max: 200 },
    ],
  },
};

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/** Checks a form's answers. Returns { form, values } or { error }. */
export function validateForm(data) {
  const form = FORMS[data.form];
  if (!form) return { error: "The form could not be found." };
  const values = {};
  for (const f of form.fields) {
    const value = String(data[f.name] ?? "").trim();
    if (f.required && !value) return { form, error: `Please fill in "${f.label}".` };
    if (value.length > f.max) return { form, error: `"${f.label}" can be up to ${f.max} characters.` };
    if (f.email && value && !EMAIL.test(value)) return { form, error: "Please enter an email address, like name@example.com." };
    values[f.name] = value;
  }
  if (data.form === "feedback") {
    if (values.where === "Other") {
      if (!values.where_other) return { form, error: 'Please say where we worked together, or choose one of the places listed.' };
    } else if (!WORKED_ON.includes(values.where)) {
      return { form, error: "Please choose where we worked together." };
    }
  }
  return { form, values };
}

/** The email James receives. */
export function emailFor(name, values) {
  if (name === "contact") {
    return { text: `${values.message}\n\n---\nFrom: ${values.email}\nSent from the contact form on cattell.com`, replyTo: values.email };
  }
  const where = values.where === "Other" ? values.where_other : values.where;
  return {
    text: `Where we worked together: ${where}\n\nWhat to stop, start or continue:\n${values.feedback}\n\nName: ${values.name || "(anonymous)"}\n\n---\nSent from the feedback form on cattell.com`,
  };
}

// Both keys must be set, so the form and the check always agree. The site key must match the one the website was built with.
const humanCheckOn = (env) => Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);

const redirect = (to) => new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });

const perHour = new RateLimiter(5, 60 * 60 * 1000);

// The longest real form is well under this, even written entirely in emoji.
const MAX_FORM_BYTES = 128 * 1024;

/** Handles POST /form. `send` is the fetch function used to call Turnstile and Resend (replaceable in tests). */
export async function handleForm(request, env = {}, send = fetch) {
  const site = env.SITE || "https://www.cattell.com";
  const problemPage = (message, back = "/") => page(message, back, site);
  let data;
  try {
    const sent = await readForm(request, MAX_FORM_BYTES); // stops reading at the limit
    if (!sent) return problemPage("That is too long to send. Please shorten it, or message me on Bluesky, Mastodon or LinkedIn instead.");
    data = Object.fromEntries(sent);
  } catch {
    return problemPage("The form could not be read.");
  }
  const back = FORMS[data.form]?.page || "/";

  // Spam trap: people can't see this field, but automated spammers fill it in.
  if (data.website) return redirect(site + (FORMS[data.form]?.thanks || "/"));

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (await limited(env.FORM_LIMIT, perHour, ip)) return problemPage("You have sent several forms in the last hour. Please try again later, or message me on Bluesky, Mastodon or LinkedIn instead.", back);

  const { form, values, error } = validateForm(data);
  if (error) return problemPage(error, back);

  // "Are you human" check (Cloudflare Turnstile), once both keys are set.
  if (humanCheckOn(env)) {
    const token = String(data["cf-turnstile-response"] || "");
    if (!token) return problemPage('Please complete the "are you human" check before sending. It needs JavaScript. If you can\'t use it, please message me on Bluesky, Mastodon or LinkedIn instead.', back);
    let passed = false;
    try {
      const check = await send("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }).toString(),
      });
      const result = await check.json();
      // The token must have been made on the website's own form, not copied from another site.
      passed = result.success === true && result.hostname === new URL(site).hostname;
    } catch (err) {
      console.error(`Turnstile check failed: ${err.message}`);
    }
    if (!passed) return problemPage('The "are you human" check didn\'t work. Please go back, try the check again, and send the form.', back);
  }

  if (!env.RESEND_API_KEY || !env.FORM_TO) {
    return problemPage("Sorry, this form is not working yet. Please message me on Bluesky, Mastodon or LinkedIn instead.", back);
  }
  const { text, replyTo } = emailFor(data.form, values);
  const sorry = "Sorry, your answers could not be sent just now. Please try again in a few minutes, or message me on Bluesky, Mastodon or LinkedIn instead.";
  let res;
  try {
    res = await send("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FORM_FROM || "cattell.com forms <forms@updates.cattell.com>",
      to: [env.FORM_TO],
      subject: form.subject,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
    });
  } catch (err) {
    console.error(`Form email failed: could not reach Resend: ${err.message}`);
    return problemPage(sorry, back);
  }
  if (!res.ok) {
    console.error(`Form email failed: ${res.status} ${await res.text().catch(() => "")}`);
    return problemPage(sorry, back);
  }
  return redirect(site + form.thanks);
}
