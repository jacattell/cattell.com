import { handleLogout } from "../../../lib/editor.js";
export const onRequestPost = ({ request, env }) => handleLogout(request, env);
