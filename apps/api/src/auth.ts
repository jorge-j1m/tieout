import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Two personas (D32): the unauthenticated demo viewer — every read open, every
 * mutation rejected server-side — and named operators, who are bearer tokens
 * from `API_OPERATOR_TOKENS` ("ana:token1,leo:token2"). A handful of accounts,
 * no signup flow; the web app's session login (later in Stage 3) exchanges its
 * session for the same persona model.
 */

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** Parse API_OPERATOR_TOKENS into sha256(token)-hex → operator name. */
export function parseOperatorTokens(raw: string | undefined): Map<string, string> {
  const byDigest = new Map<string, string>();
  for (const pair of (raw ?? "").split(",")) {
    const entry = pair.trim();
    if (entry === "") continue;
    const sep = entry.indexOf(":");
    if (sep <= 0 || sep === entry.length - 1) {
      throw new Error(`API_OPERATOR_TOKENS entry is not name:token — "${entry}"`);
    }
    byDigest.set(digest(entry.slice(sep + 1)), entry.slice(0, sep));
  }
  return byDigest;
}

/**
 * The operator a bearer token names, or null for the demo persona. Tokens are
 * compared as equal-length sha256 digests in constant time and never logged.
 */
export function operatorFor(
  tokens: Map<string, string>,
  authorization: string | undefined,
): string | null {
  if (authorization === undefined || !authorization.startsWith("Bearer ")) return null;
  const candidate = Buffer.from(digest(authorization.slice("Bearer ".length)));
  for (const [tokenDigest, name] of tokens) {
    if (timingSafeEqual(candidate, Buffer.from(tokenDigest))) return name;
  }
  return null;
}
