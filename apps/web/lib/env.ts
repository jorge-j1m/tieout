import "server-only";

/**
 * Typed access to the web tier's two environment knobs. Server-only by import
 * guard: neither value belongs in a client bundle.
 */

/** Where the API lives. Defaults keep the local quickstart env-free. */
export function apiBaseUrl(): string {
  return (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/+$/, "");
}

/**
 * Whether the operator session cookie demands https (D36). The flag wins when
 * set; otherwise production defaults to secure — the safe direction.
 */
export function sessionCookieSecure(): boolean {
  const flag = process.env.SESSION_COOKIE_SECURE;
  return flag !== undefined ? flag === "true" : process.env.NODE_ENV === "production";
}
