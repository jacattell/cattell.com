// The admin Worker's entry point for Cloudflare.
//   default export  admin.cattell.com (src/index.js), behind Cloudflare Access
//   ChatLogs        a private entrypoint for the public Worker's CHAT_LOG service binding.
//                   It can't be reached from the internet, only through that binding.
// Tests import src/index.js and src/chatlog.js directly, because "cloudflare:workers" only exists on Cloudflare.
import { WorkerEntrypoint } from "cloudflare:workers";
import worker from "./index.js";
import { chatLogMethods } from "./chatlog.js";

export class ChatLogs extends WorkerEntrypoint {
  async allow() { return chatLogMethods(this.env).allow(); }
  async save(data) { return chatLogMethods(this.env).save(data); }
}

export default worker;
