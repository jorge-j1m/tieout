import { z } from "zod";
import { breakTypeSchema, EXCEPTION_STATUSES } from "./canonical.js";

/**
 * Stage 3 API request schemas. Responses are serialized rows (bigint money as
 * strings, D5); their schemas arrive with the web client that parses them.
 */

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const breaksQuerySchema = listQuerySchema.extend({
  type: breakTypeSchema.optional(),
});

export const exceptionsQuerySchema = listQuerySchema.extend({
  status: z.enum(EXCEPTION_STATUSES).optional(),
  /** Exact-match lookup — exceptions are fingerprint-keyed cases (D18/D30). */
  fingerprint: z.string().optional(),
});

/** Annotations, not documents — and the demo lends its operator key to the public (D36). */
const CASE_TEXT_MAX = 500;

export const acknowledgeBodySchema = z.object({
  note: z.string().min(1).max(CASE_TEXT_MAX).optional(),
});

/** A resolution without a reason is no resolution (D30). */
export const resolveBodySchema = z.object({
  reason: z.string().min(1).max(CASE_TEXT_MAX),
});
