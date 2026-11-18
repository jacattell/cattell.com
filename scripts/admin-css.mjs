// Copies the website's styles into the admin pages' styles (workers/admin/public/admin.css),
// keeping the admin-only part at the end.
import fs from "node:fs";
const site = fs.readFileSync("assets/css/site.css", "utf8");
const file = "workers/admin/public/admin.css";
const [, adminPart] = fs.readFileSync(file, "utf8").split("/* ---- end of site.css ---- */");
fs.writeFileSync(file, `/* Admin pages. The first part is a copy of the website's assets/css/site.css (npm run admin:css updates it). */\n${site}/* ---- end of site.css ---- */${adminPart}`);
console.log("Updated admin.css");
