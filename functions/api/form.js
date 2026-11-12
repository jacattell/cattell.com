// Cloudflare Pages Function for /api/form. The work is done in lib/forms.js.
import { handleForm } from "../../lib/forms.js";

export const onRequest = (context) => handleForm(context.request, context.env);
