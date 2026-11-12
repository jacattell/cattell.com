// The contact and feedback forms (POST /api/form). Each answer is emailed to
// James through Resend (https://resend.com); nothing is stored on the website.
import { RateLimiter } from "./chat.js";

// The places listed on the feedback form (src/feedback.njk reads this list too).
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

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function problemPage(message, back = "/") {
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>There is a problem - James Arthur Cattell</title><link rel="stylesheet" href="/assets/css/site.css"></head><body><main id="main" class="wrap"><h1>There is a problem</h1><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(back)}">Go back to the form</a>. Your answers may still be there.</p></main></body></html>`;
  return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

const redirect = (to) => new Response(null, { status: 303, headers: { Location: to } });

const perHour = new RateLimiter(5, 60 * 60 * 1000);

/** Handles POST /api/form. `send` is the fetch function used to call Resend (replaceable in tests). */
export async function handleForm(request, env = {}, send = fetch) {
  if (request.method !== "POST") return new Response("Use POST.", { status: 405, headers: { Allow: "POST" } });
  let data;
  try {
    data = Object.fromEntries(await request.formData());
  } catch {
    return problemPage("The form could not be read.");
  }
  const back = FORMS[data.form]?.page || "/";

  // Spam trap: people can't see this field, but automated spammers fill it in.
  if (data.website) return redirect(FORMS[data.form]?.thanks || "/");

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!perHour.allow(ip)) return problemPage("You have sent several forms in the last hour. Please try again later, or email me instead.", back);

  const { form, values, error } = validateForm(data);
  if (error) return problemPage(error, back);

  if (!env.RESEND_API_KEY || !env.FORM_TO) {
    return problemPage("Sorry, this form is not working yet. Please email me instead.", back);
  }
  const { text, replyTo } = emailFor(data.form, values);
  const sorry = "Sorry, your answers could not be sent just now. Please try again in a few minutes, or email me instead.";
  let res;
  try {
    res = await send("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FORM_FROM || "cattell.com forms <forms@cattell.com>",
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
  return redirect(form.thanks);
}
