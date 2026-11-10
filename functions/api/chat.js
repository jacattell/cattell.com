// Cloudflare Pages Function for /api/chat. The work is done in lib/chat.js.
import { handleChat } from "../../lib/chat.js";

export async function onRequest(context) {
  const result = await handleChat(context.request, context.env);
  if (result instanceof Response) return result;
  // Keep the function running until Claude's reply has finished streaming.
  context.waitUntil(result.done);
  return result.response;
}
