import "server-only";
import type { z } from "zod";
import { apiBaseUrl } from "../env";

/**
 * The one door to the API. Every response is parsed against its contracts
 * schema before any component sees it — a drifted shape fails loudly at the
 * boundary instead of rendering something quietly wrong. Server components
 * only; nothing here (URLs, tokens) ever reaches a client bundle.
 */

export class ApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`API ${path} responded ${status}`);
    this.name = "ApiError";
  }
}

/** GET `path`, require 2xx, parse with `schema`. Fresh on every request (`no-store`). */
export async function fetchJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, { cache: "no-store", ...init });
  if (!response.ok) throw new ApiError(path, response.status);
  return schema.parse(await response.json());
}

/**
 * POST `path` with a JSON body and an operator bearer token — the web's only
 * write path, used by the exception mutations. Returns the API's own error
 * message on failure so the operator sees why (a 401 for a lapsed session, a 409
 * for an illegal transition) rather than a generic wall.
 */
export async function postJson(
  path: string,
  body: unknown,
  token: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (response.ok) return { ok: true };
  const detail = (await response.json().catch(() => null)) as { error?: string } | null;
  return {
    ok: false,
    status: response.status,
    error: detail?.error ?? `API ${path} responded ${response.status}`,
  };
}

/** Like `fetchJson`, but a 404 becomes `null` — the RSC signal for `notFound()`. */
export async function fetchJsonOrNull<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T | null> {
  try {
    return await fetchJson(path, schema, init);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
