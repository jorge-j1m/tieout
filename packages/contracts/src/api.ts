import { z } from "zod";
import { breakTypeSchema, EXCEPTION_STATUSES } from "./canonical.js";
import {
  citationSchema,
  INVESTIGATION_EVENT_KINDS,
  INVESTIGATION_MESSAGE_ROLES,
  INVESTIGATION_TEXT_MAX,
  toolTrailEntrySchema,
} from "./investigation.js";

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

/**
 * A turn appended to a case's investigation (D38). The streaming route handler
 * posts this server-side with the operator token; the API derives the actor from
 * the token (the body never sets who wrote it). `parts` is the AI SDK UIMessage
 * shape; `text` its flattened body. `supersedesId` + a non-`created` `eventKind`
 * record an edit/retry (append-only — the superseded turn is retained).
 */
export const appendInvestigationMessageBodySchema = z.object({
  role: z.enum(INVESTIGATION_MESSAGE_ROLES),
  text: z.string().min(1).max(INVESTIGATION_TEXT_MAX),
  parts: z.array(z.unknown()).default([]),
  citations: z.array(citationSchema).max(64).default([]),
  toolTrail: z.array(toolTrailEntrySchema).max(64).default([]),
  model: z.string().max(120).nullish(),
  promptVersion: z.string().max(60).nullish(),
  usage: z.record(z.string(), z.unknown()).nullish(),
  supersedesId: z.uuid().nullish(),
  eventKind: z.enum(INVESTIGATION_EVENT_KINDS).default("created"),
});

/** Tombstoning a turn (D38): an optional reason, appended to the audit log; the row stays. */
export const deleteInvestigationMessageBodySchema = z.object({
  note: z.string().max(CASE_TEXT_MAX).optional(),
});
