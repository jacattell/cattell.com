// Public settings the forms need: the Turnstile site key (if set). See lib/forms.js.
import { handleFormConfig } from "../../lib/forms.js";
export const onRequestGet = (context) => handleFormConfig(context.env);
