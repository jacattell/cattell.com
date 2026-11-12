// Week notes editor API: /api/edit/me, /api/edit/notes, /api/edit/note, /api/edit/preview
import { handleEdit } from "../../../lib/editor.js";
export const onRequest = (context) => handleEdit(context.request, context.env);
