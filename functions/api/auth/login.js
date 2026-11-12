import { handleLogin } from "../../../lib/editor.js";
export const onRequestGet = (context) => handleLogin(context.request, context.env);
