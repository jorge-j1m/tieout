import { z } from "zod";
import {
  BREAK_TYPES,
  CANONICAL_TXN_TYPES,
  EXCEPTION_EVENT_KINDS,
  EXCEPTION_STATUSES,
  MATCH_KINDS,
  QUARANTINE_STAGES,
  RUN_STATUSES,
  TXN_STATUSES,
} from "./canonical.js";
import { TRIAGE_CLASSIFICATIONS, TRIAGE_CONFIDENCES } from "./triage.js";

/**
 * The API's response boundary. `apps/api` serializes Drizzle rows through a
 * bigint-aware JSON replacer (D5): money and other bigint columns arrive as
 * strings, never numbers, and the web client parses every payload through these
 * schemas so a shape drift fails loudly at the edge instead of rendering wrong.
 * Shapes mirror `packages/db/src/schema.ts` and `packages/core` break details.
 */

/** Integer minor units as a string — the only representation money ever takes here. */
export const moneyStringSchema = z
  .string()
  .regex(/^-?\d+$/, "money must be integer minor units serialized as a string");

/** An ISO-8601 UTC instant. Rendered UTC-explicit; never parsed into local time for display. */
const iso = z.string();
/** A free-form jsonb object (metadata, details, control totals). */
const jsonObject = z.record(z.string(), z.unknown());

// ── Runs ────────────────────────────────────────────────────────────────────

/** `recon_runs.stats` — the persisted `ReconSummary` (packages/contracts/src/recon.ts). */
export const reconStatsSchema = z.object({
  runId: z.string(),
  asOf: iso,
  rulesetVersion: z.string(),
  matches: z.number().int(),
  matchedTransactions: z.number().int(),
  /** Keyed by break type; only types that occurred are present. */
  breaks: z.record(z.string(), z.number().int()),
  totalBreaks: z.number().int(),
  /** Settlement-lag suppressions by source (D12); empty when no lag is configured. */
  pendingBySource: z.record(z.string(), z.number().int()),
});

export const runSchema = z.object({
  id: z.string(),
  asOf: iso,
  rulesetVersion: z.string(),
  status: z.enum(RUN_STATUSES),
  stats: reconStatsSchema,
  startedAt: iso,
  finishedAt: iso.nullable(),
  createdAt: iso,
});

/** An FX rate a run applied (D7): rate is a decimal string, never a float. */
export const fxRateSchema = z.object({
  base: z.string(),
  quote: z.string(),
  rate: z.string(),
  rateSource: z.string(),
  rateDate: z.string(),
});

/** The run's recorded configuration, folded onto the single-run response. */
export const runConfigSchema = z.object({
  fxRates: z.array(fxRateSchema),
});

export const runDetailSchema = runSchema.extend({ config: runConfigSchema });

// ── Breaks ──────────────────────────────────────────────────────────────────

/** What a break records about each consumed transaction (packages/core BreakTxnDetail). */
export const breakTxnDetailSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  source: z.string(),
  sourceAccount: z.string(),
  sourceId: z.string(),
  type: z.enum(CANONICAL_TXN_TYPES),
  amountMinor: moneyStringSchema,
  netMinor: moneyStringSchema,
  currency: z.string(),
  occurredAt: iso,
  reference: z.string().nullable(),
  groupRef: z.string().nullable(),
});

/**
 * `breaks.details` always carries `txns`; per-type extras (`reference`,
 * `deltaMinor`/`toleranceMinor`, `feeNetMinor`, `groupKey`, applied FX rate) ride
 * the catchall so the explain presenter can derive the "what matching tried"
 * narrative from facts without a bespoke schema per type.
 */
export const breakDetailsSchema = z
  .object({ txns: z.array(breakTxnDetailSchema) })
  .catchall(z.unknown());

export const breakSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: z.enum(BREAK_TYPES),
  details: breakDetailsSchema,
  fingerprint: z.string().nullable(),
  createdAt: iso,
});

// ── Transactions, raw records, ingestion batches ──────────────────────────────

export const transactionSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  version: z.number().int(),
  isCurrent: z.boolean(),
  supersededAt: iso.nullable(),
  isTombstone: z.boolean(),
  source: z.string(),
  sourceAccount: z.string(),
  sourceId: z.string(),
  sourceType: z.string(),
  type: z.enum(CANONICAL_TXN_TYPES),
  amountMinor: moneyStringSchema,
  netMinor: moneyStringSchema.nullable(),
  currency: z.string(),
  occurredAt: iso,
  valueDate: z.string().nullable(),
  observedAt: iso,
  account: z.string(),
  reference: z.string().nullable(),
  groupRef: z.string().nullable(),
  status: z.enum(TXN_STATUSES),
  normalizerVersion: z.string(),
  metadata: jsonObject,
  createdAt: iso,
});

/** A transaction plus its full version chain, ascending (the §8 explain hop 3). */
export const transactionWithVersionsSchema = transactionSchema.extend({
  versions: z.array(transactionSchema),
});

export const batchSchema = z.object({
  id: z.string(),
  seq: z.number(),
  source: z.string(),
  connection: z.string(),
  kind: z.string(),
  externalRef: z.string(),
  idempotencyKey: z.string(),
  contentHash: z.string(),
  controlTotals: jsonObject.nullable(),
  status: z.string(),
  unitKey: z.string().nullable(),
  archiveUrl: z.string().nullable(),
  observedAt: iso,
  createdAt: iso,
});

/** A raw record plus its ingestion batch (the §8 explain hops 4–5). */
export const rawWithBatchSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  source: z.string(),
  sourceAccount: z.string(),
  sourceId: z.string(),
  version: z.number().int(),
  contentHash: z.string(),
  /** jsonb: an object for API sources, a delimited string for file sources. */
  payload: z.unknown(),
  isTombstone: z.boolean(),
  observedAt: iso,
  createdAt: iso,
  batch: batchSchema.optional(),
});

// ── Matches ───────────────────────────────────────────────────────────────────

export const matchMemberSchema = z.object({
  transactionId: z.string(),
  transactionVersion: z.number().int(),
});

export const matchWithMembersSchema = z.object({
  id: z.string(),
  runId: z.string(),
  rulesetVersion: z.string(),
  kind: z.enum(MATCH_KINDS),
  details: jsonObject.nullable(),
  createdAt: iso,
  members: z.array(matchMemberSchema),
});

// ── Exceptions, events, triage ────────────────────────────────────────────────

export const exceptionSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  type: z.enum(BREAK_TYPES),
  status: z.enum(EXCEPTION_STATUSES),
  firstSeenRunId: z.string(),
  lastSeenRunId: z.string(),
  currentBreakId: z.string(),
  createdAt: iso,
  updatedAt: iso,
  /** Distinct runs that reported the underlying break (computed by the API). */
  seenInRuns: z.number().int(),
});

export const exceptionEventSchema = z.object({
  id: z.string(),
  exceptionId: z.string(),
  kind: z.enum(EXCEPTION_EVENT_KINDS),
  actor: z.string(),
  note: z.string().nullable(),
  runId: z.string().nullable(),
  createdAt: iso,
});

export const triageSuggestionSchema = z.object({
  id: z.string(),
  exceptionId: z.string(),
  breakId: z.string(),
  inputHash: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  classification: z.enum(TRIAGE_CLASSIFICATIONS),
  confidence: z.enum(TRIAGE_CONFIDENCES),
  explanation: z.string(),
  suggestedAction: z.string(),
  createdAt: iso,
});

export const exceptionDetailSchema = exceptionSchema.extend({
  currentBreak: breakSchema.nullable(),
  events: z.array(exceptionEventSchema),
  triageSuggestions: z.array(triageSuggestionSchema),
});

// ── Quarantine, sources, run diff, persona ────────────────────────────────────

export const quarantineSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  rawId: z.string().nullable(),
  stage: z.enum(QUARANTINE_STAGES),
  source: z.string(),
  sourceAccount: z.string().nullable(),
  sourceId: z.string().nullable(),
  normalizerVersion: z.string().nullable(),
  errors: z.unknown(),
  payload: z.unknown(),
  observedAt: iso,
  createdAt: iso,
});

export const sourceSummarySchema = z.object({
  source: z.string(),
  records: z.number().int(),
  batches: z.number().int(),
  lastLanded: iso.nullable(),
  quarantinedUnits: z.number().int(),
});

const diffEntrySchema = z.object({
  exceptionId: z.string(),
  fingerprint: z.string(),
  type: z.enum(BREAK_TYPES),
});

export const runDiffSchema = z.object({
  runId: z.string(),
  appeared: z.array(diffEntrySchema),
  reopened: z.array(diffEntrySchema),
  selfResolved: z.array(diffEntrySchema),
});

export const meSchema = z.object({ operator: z.string().nullable() });

// ── Inferred types ────────────────────────────────────────────────────────────

export type ReconStats = z.infer<typeof reconStatsSchema>;
export type Run = z.infer<typeof runSchema>;
export type FxRate = z.infer<typeof fxRateSchema>;
export type RunConfig = z.infer<typeof runConfigSchema>;
export type RunDetail = z.infer<typeof runDetailSchema>;
export type BreakTxnDetail = z.infer<typeof breakTxnDetailSchema>;
export type BreakDetails = z.infer<typeof breakDetailsSchema>;
export type Break = z.infer<typeof breakSchema>;
export type TransactionRow = z.infer<typeof transactionSchema>;
export type TransactionWithVersions = z.infer<typeof transactionWithVersionsSchema>;
export type Batch = z.infer<typeof batchSchema>;
export type RawWithBatch = z.infer<typeof rawWithBatchSchema>;
export type MatchMember = z.infer<typeof matchMemberSchema>;
export type MatchWithMembers = z.infer<typeof matchWithMembersSchema>;
export type ExceptionRow = z.infer<typeof exceptionSchema>;
export type ExceptionEvent = z.infer<typeof exceptionEventSchema>;
export type TriageSuggestion = z.infer<typeof triageSuggestionSchema>;
export type ExceptionDetail = z.infer<typeof exceptionDetailSchema>;
export type QuarantineRow = z.infer<typeof quarantineSchema>;
export type SourceSummary = z.infer<typeof sourceSummarySchema>;
export type RunDiff = z.infer<typeof runDiffSchema>;
export type Me = z.infer<typeof meSchema>;
