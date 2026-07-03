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
export const breaksByTypeHref = (type: string): Route => `/breaks?type=${type}` as Route;
export const exceptionHref = (id: string): Route => `/exceptions/${id}` as Route;
