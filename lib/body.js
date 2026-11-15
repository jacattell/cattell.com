// Reads what a visitor sent, but never more than a set size.
//
// request.text() and request.formData() read everything before any limit can be
// checked, so a very large request would use up memory first. This stops as soon
// as the limit is passed.

/** @returns the bytes sent, or null if there were more than maxBytes. */
export async function readBytes(request, maxBytes) {
  if (Number(request.headers.get("Content-Length")) > maxBytes) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.byteLength;
  }
  return all;
}

/** @returns the text sent, or null if it was bigger than maxBytes. */
export async function readText(request, maxBytes) {
  const bytes = await readBytes(request, maxBytes);
  return bytes && new TextDecoder().decode(bytes);
}

/** @returns the form fields sent, or null if the form was bigger than maxBytes. Throws if it isn't a form. */
export async function readForm(request, maxBytes) {
  const bytes = await readBytes(request, maxBytes);
  if (!bytes) return null;
  const copy = new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("Content-Type") || "" }, body: bytes });
  return copy.formData();
}
