// cattell-public: the only code visitors to www.cattell.com can reach.
// It runs on its own address, https://api.cattell.com, with no cookies and no
// access to the admin data, so a problem here can't reach anything private.
//   POST /form  contact and feedback forms (src/forms.js)
import { handleForm } from "./forms.js";
import { json, secure } from "../../shared/http.js";

/** Only the website itself may use the API. Browsers always send Origin with these requests. */
export function fromSite(request, env) {
  return request.headers.get("Origin") === (env.SITE || "https://www.cattell.com");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Only answer on the real address, not on workers.dev or preview addresses.
    if (url.hostname !== (env.API_HOST || "api.cattell.com")) return secure(new Response("Not found", { status: 404 }));

    if (url.pathname === "/form") {
      if (request.method !== "POST") return secure(new Response("Use POST.", { status: 405, headers: { Allow: "POST" } }));
      if (!fromSite(request, env)) return secure(new Response("Not allowed.", { status: 403 }));
      return secure(await handleForm(request, env));
    }

    if (url.pathname === "/") return secure(new Response(null, { status: 302, headers: { Location: env.SITE || "https://www.cattell.com" } }));
    return secure(new Response("Not found", { status: 404 }));
  },
};
