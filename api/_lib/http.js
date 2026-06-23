// api/_lib/http.js
// Tiny helpers so every route ends up with the same shape.
export function ok(res, data) {
  res.status(200).json({ ok: true, ...data });
}

export function bad(res, code, message, extra = {}) {
  res.status(code).json({ ok: false, error: message, ...extra });
}

export function methodNotAllowed(res, allowed) {
  res.setHeader("Allow", allowed.join(", "));
  bad(res, 405, "Method not allowed");
}

/** Very small allow-list check. Keeps the routes honest. */
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
export function isValidWallet(s) {
  return typeof s === "string" && WALLET_RE.test(s);
}
