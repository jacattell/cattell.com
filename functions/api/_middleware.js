// Runs before everything under /api/: the API only answers on the site's own
// address, not the project's pages.dev addresses. See lib/address.js.
import { refuseOtherAddress } from "../../lib/address.js";
export const onRequest = (context) => refuseOtherAddress(context.request) ?? context.next();
