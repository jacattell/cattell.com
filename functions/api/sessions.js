// Cloudflare Pages Function for /api/sessions: the upload scripts send sessions here.
// The work is done in lib/sessions.js.
import { handleUpload } from "../../lib/sessions.js";
export const onRequest = (context) => handleUpload(context.request, context.env);
