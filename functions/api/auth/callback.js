import { handleCallback } from "../../../lib/editor.js";
export const onRequestGet = (context) => handleCallback(context.request, context.env);
