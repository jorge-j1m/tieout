import "server-only";
import { cache } from "react";
import { z } from "zod";
import {
  breakSchema,
  exceptionDetailSchema,
  exceptionSchema,
  matchWithMembersSchema,
  meSchema,
  quarantineSchema,
  rawWithBatchSchema,
  runDetailSchema,
  runDiffSchema,
  runSchema,
  sourceSummarySchema,
  transactionWithVersionsSchema,
  type Break,
  type BreakType,
  type ExceptionStatus,
} from "@tieout/contracts";
import { fetchJson, fetchJsonOrNull } from "./client";

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
const exceptionsSchema = z.array(exceptionSchema);

export const getRuns = cache((limit = 50) => fetchJson(`/runs?limit=${limit}`, runsSchema));

export const getRun = cache((id: string) => fetchJsonOrNull(`/runs/${id}`, runDetailSchema));

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
  (opts: { status?: ExceptionStatus; limit?: number } = {}) => {
    const params = new URLSearchParams({ limit: String(opts.limit ?? 200) });
    if (opts.status !== undefined) params.set("status", opts.status);
    return fetchJson(`/exceptions?${params}`, exceptionsSchema);
  },
);

export const getException = cache((id: string) =>
  fetchJsonOrNull(`/exceptions/${id}`, exceptionDetailSchema),
);

/** Who a bearer token names — `null` operator means the demo persona. Uncached: auth. */
export const getMe = (token?: string) =>
  fetchJson("/me", meSchema, {
    headers: token !== undefined ? { authorization: `Bearer ${token}` } : {},
  });
