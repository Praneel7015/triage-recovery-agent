/**
 * The Razorpay SDK rejects failed API calls with a plain
 * `{ statusCode, error: { code, description } }` object, not an Error, so
 * `(err as Error).message` is undefined there. Read whichever shape arrived.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object") {
    const e = err as { error?: { description?: unknown; code?: unknown }; message?: unknown; statusCode?: unknown };
    if (typeof e.error?.description === "string" && e.error.description) return e.error.description;
    if (typeof e.message === "string" && e.message) return e.message;
    if (typeof e.error?.code === "string" && e.error.code) return e.error.code;
    if (typeof e.statusCode === "number") return `HTTP ${e.statusCode}`;
  }
  return "Unknown error";
}
