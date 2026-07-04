import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { Me } from "@tieout/contracts";
import { getMe } from "./api/endpoints";

/**
 * The operator session (D36). The browser holds an httpOnly cookie carrying the
 * operator's API bearer token — never readable by client JS, never a source of
 * truth on its own. The API stays the guard: every mutation re-validates the
 * token server-side, so a forged cookie buys nothing. The web only reads it to
 * decide which chrome to show.
 */

/** httpOnly cookie holding the operator's API bearer token. */
export const SESSION_COOKIE = "tieout_op";

/** The raw operator token from the session cookie, or undefined for the demo persona. */
export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

/**
 * Who the current request is, resolved server-side. No cookie is the demo
 * persona — the common case — so it short-circuits without touching the API. A
 * present-but-stale token degrades to demo rather than erroring the whole page.
 * Cached per request so every component that asks resolves one `/me` at most.
 */
export const getPersona = cache(async (): Promise<Me> => {
  const token = await getSessionToken();
  if (token === undefined) return { operator: null, investigate: false };
  return getMe(token).catch(() => ({ operator: null, investigate: false }));
});
