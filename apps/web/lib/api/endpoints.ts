import "server-only";
import { cache } from "react";
import { z } from "zod";
import {
  appendInvestigationMessageBodySchema,
  breakSchema,
  exceptionDetailSchema,
  exceptionRowSchema,
  investigationBudgetSchema,
  investigationThreadSchema,
  matchWithMembersSchema,
  meSchema,
  quarantineSchema,
  rawWithBatchSchema,
  runDiffSchema,
  runSchema,
  sourceSummarySchema,
  transactionWithVersionsSchema,
  type Break,
  type BreakType,
  type ExceptionStatus,
} from "@tieout/contracts";
import { fetchJson, fetchJsonOrNull, postJson } from "./client";

/** What the append endpoint accepts (defaults optional) — the route handler builds this. */
export type AppendInvestigationMessageBody = z.input<typeof appendInvestigationMessageBodySchema>;

/**
 * One function per API route, each returning contracts-parsed data. Wrapped in
 * React `cache()` so a render pass that needs the same read twice (layout +
 * page both want the latest run) issues one request, not two.
 */

const runsSchema = z.array(runSchema);
const breaksSchema = z.array(breakSchema);
const matchesSchema = z.array(matchWithMembersSchema);
const sourcesSchema = z.array(sourceSummarySchema);
const quarantinesSchema = z.array(quarantineSchema);
const exceptionsSchema = z.array(exceptionRowSchema);

export const getRuns = cache((limit = 50) => fetchJson(`/runs?limit=${limit}`, runsSchema));

export const getRun = cache((id: string) => fetchJsonOrNull(`/runs/${id}`, runSchema));

export const getRunDiff = cache((id: string) => fetchJsonOrNull(`/runs/${id}/diff`, runDiffSchema));

export const getRunBreaks = cache(
  (id: string, opts: { type?: BreakType; limit?: number } = {}): Promise<Break[] | null> => {
    const params = new URLSearchParams({ limit: String(opts.limit ?? 200) });
    if (opts.type !== undefined) params.set("type", opts.type);
    return fetchJsonOrNull(`/runs/${id}/breaks?${params}`, breaksSchema);
  },
);

export const getRunMatches = cache((id: string) =>
  fetchJsonOrNull(`/runs/${id}/matches`, matchesSchema),
);

export const getSources = cache(() => fetchJson("/sources", sourcesSchema));

export const getBreak = cache((id: string) => fetchJsonOrNull(`/breaks/${id}`, breakSchema));

export const getTransaction = cache((id: string) =>
  fetchJsonOrNull(`/transactions/${id}`, transactionWithVersionsSchema),
);

export const getRaw = cache((id: string) => fetchJsonOrNull(`/raw/${id}`, rawWithBatchSchema));

export const getQuarantine = cache((limit = 50) =>
  fetchJson(`/quarantine?limit=${limit}`, quarantinesSchema),
);

export const getExceptions = cache(
  (opts: { status?: ExceptionStatus; fingerprint?: string; limit?: number } = {}) => {
    const params = new URLSearchParams({ limit: String(opts.limit ?? 200) });
    if (opts.status !== undefined) params.set("status", opts.status);
    if (opts.fingerprint !== undefined) params.set("fingerprint", opts.fingerprint);
    return fetchJson(`/exceptions?${params}`, exceptionsSchema);
  },
);

export const getException = cache((id: string) =>
  fetchJsonOrNull(`/exceptions/${id}`, exceptionDetailSchema),
);

/**
 * The case tracking a break, found by the shared fingerprint (exceptions key on
 * it, D18) — one indexed lookup, then the detail read. This runs on every
 * break-explain view, so it must not scale with the worklist's size.
 */
export const getExceptionByFingerprint = cache(async (fingerprint: string | null) => {
  if (fingerprint === null) return null;
  const [match] = await getExceptions({ fingerprint, limit: 1 });
  return match !== undefined ? getException(match.id) : null;
});

/** Who a bearer token names — `null` operator means the demo persona. Uncached: auth. */
export const getMe = (token?: string) =>
  fetchJson("/me", meSchema, {
    headers: token !== undefined ? { authorization: `Bearer ${token}` } : {},
  });

// ── Investigation (D38) ───────────────────────────────────────────────────────

/**
 * The saved conversation for a case — open to every persona. `null` means no
 * such case (404); an existing case with an empty thread returns `threadId: null`
 * with no messages. Read by the case page (render) and the streaming route
 * handler (Clara's context).
 */
export const getInvestigation = cache((exceptionId: string) =>
  fetchJsonOrNull(`/exceptions/${exceptionId}/investigation`, investigationThreadSchema),
);

/** The live-spend gate — checked before a stream starts. Uncached: it moves every turn. */
export const getInvestigationBudget = () =>
  fetchJson("/investigate/budget", investigationBudgetSchema);

/** Append a turn (operator token). The API derives authorship; the body can't spoof it. */
export const appendInvestigationMessage = (
  exceptionId: string,
  body: AppendInvestigationMessageBody,
  token: string,
) => postJson(`/exceptions/${exceptionId}/investigation/messages`, body, token);

/** Tombstone a turn (operator token): the row is retained, a `deleted` event appended. */
export const deleteInvestigationMessage = (messageId: string, token: string, note?: string) =>
  postJson(
    `/investigation/messages/${messageId}/delete`,
    note !== undefined ? { note } : {},
    token,
  );
