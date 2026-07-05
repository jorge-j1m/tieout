import type { Route } from "next";

/**
 * Typed hrefs for dynamic routes. `typedRoutes` verifies static links at compile
 * time but can't narrow an interpolated string, so the unavoidable casts live
 * here — one audited place — instead of scattered through components. Change a
 * route's shape and you change it once.
 */
export const runHref = (id: string): Route => `/runs/${id}` as Route;
export const runTabHref = (id: string, tab: string): Route => `/runs/${id}?tab=${tab}` as Route;
export const breakHref = (id: string): Route => `/breaks/${id}` as Route;

/** The worklist with a set of filters applied; empty params give the bare route. */
export const breaksHref = (params: { run?: string; type?: string; status?: string }): Route => {
  const q = new URLSearchParams();
  if (params.run !== undefined) q.set("run", params.run);
  if (params.type !== undefined) q.set("type", params.type);
  if (params.status !== undefined) q.set("status", params.status);
  const query = q.toString();
  return (query === "" ? "/breaks" : `/breaks?${query}`) as Route;
};

export const breaksByTypeHref = (type: string): Route => `/breaks?type=${type}` as Route;
export const exceptionHref = (id: string): Route => `/exceptions/${id}` as Route;

/** The exceptions worklist, optionally filtered to one status tab. */
export const exceptionsHref = (status?: string): Route =>
  (status === undefined ? "/exceptions" : `/exceptions?status=${status}`) as Route;

/**
 * Where a verified citation links (D38). Runs, breaks, and cases have their own
 * pages; a transaction or raw record is shown inside the evidence chain, so those
 * marks link to the case's break page when we know it, else render unlinked.
 */
export function citationHref(
  kind: "transaction" | "raw" | "run" | "break" | "exception",
  id: string,
  breakId?: string,
): Route | null {
  switch (kind) {
    case "run":
      return runHref(id);
    case "break":
      return breakHref(id);
    case "exception":
      return exceptionHref(id);
    case "transaction":
    case "raw":
      return breakId !== undefined ? breakHref(breakId) : null;
  }
}
