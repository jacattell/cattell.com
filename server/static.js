// Serves the built website from the _site folder.
import fs from "node:fs";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
};

/** Where an address from the old Google Sites website now lives, or null. */
export function oldUrlRedirect(pathname) {
  const p = pathname.replace(/\/+$/, "") || "/";
  const note = /^\/week-notes\/(?:\d{4}\/)?(\d{4})-week-(\d{1,2})$/.exec(p);
  if (note) return `/week-notes/${note[1]}/${note[2].padStart(2, "0")}/`;
  if (p === "/james" || p === "/home" || p === "/personal") return "/";
  if (p === "/weeknotes") return "/week-notes/";
  return null;
}

/** Turns a URL path into a file inside root, or null if it would fall outside it. */
export function resolveFile(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const file = path.resolve(root, "." + path.posix.normalize("/" + decoded));
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return file;
}

export function createStaticHandler(root) {
  root = path.resolve(root);

  function sendFile(req, res, file, status = 200) {
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const isAsset = file.startsWith(path.join(root, "assets") + path.sep);
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": isAsset ? "public, max-age=86400" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  }

  function notFound(req, res) {
    const page = path.join(root, "404.html");
    if (fs.existsSync(page)) return sendFile(req, res, page, 404);
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Page not found");
  }

  return function handleStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end();
    }
    const redirect = oldUrlRedirect(url.pathname);
    if (redirect) {
      res.writeHead(301, { Location: redirect });
      return res.end();
    }
    const file = resolveFile(root, url.pathname);
    if (!file) return notFound(req, res);

    let stat = fs.statSync(file, { throwIfNoEntry: false });
    if (stat && stat.isDirectory()) {
      if (!url.pathname.endsWith("/")) {
        res.writeHead(301, { Location: url.pathname + "/" + url.search });
        return res.end();
      }
      const index = path.join(file, "index.html");
      stat = fs.statSync(index, { throwIfNoEntry: false });
      return stat ? sendFile(req, res, index) : notFound(req, res);
    }
    return stat && stat.isFile() ? sendFile(req, res, file) : notFound(req, res);
  };
}
