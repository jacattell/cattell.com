// Runs before everything under /api/:
// - the API only answers on the site's own address, not the project's pages.dev
//   addresses (lib/address.js);
// - every reply gets the security headers the site's pages have (lib/api-headers.js).
import { refuseOtherAddress } from "../../lib/address.js";
import { withSecurityHeaders } from "../../lib/api-headers.js";

export const onRequest = async (context) => withSecurityHeaders(refuseOtherAddress(context.request) ?? (await context.next()));
