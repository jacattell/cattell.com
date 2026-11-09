// Runs cattell.com: serves the built website and the chat endpoint.
// Build the site first with `npm run build`, then start this with `npm start`.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChatHandler } from "./chat.js";
import { createStaticHandler } from "./static.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.join(here, "..", "_site");
const port = Number(process.env.PORT || 3000);

const handleChat = createChatHandler({ contextFile: path.join(siteDir, "chat-context.txt") });
const handleStatic = createStaticHandler(siteDir);

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (url.pathname === "/api/chat") {
    handleChat(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    return;
  }
  handleStatic(req, res, url);
});

server.listen(port, () => {
  console.log(`cattell.com is running on port ${port}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log("ANTHROPIC_API_KEY is not set, so the chat page is switched off.");
});
