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
/**
 * Instants must be ISO-8601 UTC. Validated, not assumed: a driver or SQL change
 * that emits another format (it happened — Postgres `to_char` text) must fail
 * here at the boundary, not render as `NaN` in a page's date formatter.
 */
const iso = z.iso.datetime();
/** A free-form jsonb object (metadata, details, control totals). */
const jsonObject = z.record(z.string(), z.unknown());

// ── Runs ────────────────────────────────────────────────────────────────────

/** An FX rate a run applied (D7): rate is a decimal string, never a float. */
export const fxRateSchema = z.object({
  base: z.string(),
  quote: z.string(),
  rate: z.string(),
  rateSource: z.string(),
  rateDate: z.string(),
});

/** The configuration a run recorded so it stays reproducible and self-describing. */
export const runConfigSchema = z.object({
  windowMs: z.number(),
  toleranceMinor: moneyStringSchema,
  fxToleranceBps: z.number().nullable(),
  fxRates: z.array(fxRateSchema),
  lagMsBySource: z.record(z.string(), z.number()).nullable(),
  duplicateWindowMs: z.number().nullable(),
});

/** A transaction the run held as pending inside its settlement-lag window (D12). */
export const pendingRefSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  source: z.string(),
  sourceId: z.string(),
});

/**
 * `recon_runs.stats` — what the `apps/jobs` pipeline persists: counts, the
 * breaks-by-type histogram, the pending set, and the run's own config.
 *
 * Runs live forever and the shape has grown over time (D8 spirit), so the reader
 * is deliberately liberal: fields absent on older runs default, and `totalBreaks`
 * falls back to summing the histogram. Money and enums stay strict — tolerance is
 * for shape evolution, never for a number arriving as the wrong type.
 */
export const reconStatsSchema = z
  .object({
    evaluatedTransactions: z.number().int().catch(0),
    ledgerTransactions: z.number().int().catch(0),
    externalTransactions: z.number().int().catch(0),
    matches: z.number().int().catch(0),
    matchedTransactions: z.number().int().catch(0),
    breaks: z.record(z.string(), z.number().int()).catch({}),
    totalBreaks: z.number().int().optional(),
    pendingBySource: z.record(z.string(), z.number().int()).catch({}),
    pending: z.array(pendingRefSchema).catch([]),
    // Present-but-old configs simply read as null rather than failing the whole run.
    config: runConfigSchema.nullish().catch(null),
  })
  .transform((s) => ({
    ...s,
    totalBreaks: s.totalBreaks ?? Object.values(s.breaks).reduce((n, v) => n + v, 0),
    config: s.config ?? null,
  }));

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
  /** The matched transaction version, joined so the Matches tab can name both sides. */
  source: z.string(),
  sourceId: z.string(),
  amountMinor: moneyStringSchema,
  currency: z.string(),
  reference: z.string().nullable(),
  type: z.enum(CANONICAL_TXN_TYPES),
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

/**
 * A worklist row: the exception plus the few facts the table shows, computed by
 * the API so the client makes no per-row request. `reopened` is a lifecycle
 * fact (recurred after a resolution), not a fourth status; the subject fields
 * are null when the current break carries no transaction detail.
 */
export const exceptionRowSchema = exceptionSchema.extend({
  lastActor: z.string(),
  reopened: z.boolean(),
  amountMinor: moneyStringSchema.nullable(),
  currency: z.string().nullable(),
  subjectId: z.string().nullable(),
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
  /** Same lifecycle fact the worklist rows carry — computed once, by the API. */
  reopened: z.boolean(),
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
  /** The offending batch's external ref (file name), joined for a human identity. */
  batchRef: z.string().nullable(),
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

export type FxRate = z.infer<typeof fxRateSchema>;
export type RunConfig = z.infer<typeof runConfigSchema>;
export type PendingRef = z.infer<typeof pendingRefSchema>;
export type ReconStats = z.infer<typeof reconStatsSchema>;
export type Run = z.infer<typeof runSchema>;
export type BreakTxnDetail = z.infer<typeof breakTxnDetailSchema>;
export type BreakDetails = z.infer<typeof breakDetailsSchema>;
export type Break = z.infer<typeof breakSchema>;
export type TransactionRow = z.infer<typeof transactionSchema>;
export type TransactionWithVersions = z.infer<typeof transactionWithVersionsSchema>;
export type Batch = z.infer<typeof batchSchema>;
export type RawWithBatch = z.infer<typeof rawWithBatchSchema>;
export type MatchMember = z.infer<typeof matchMemberSchema>;
export type MatchWithMembers = z.infer<typeof matchWithMembersSchema>;
export type Exception = z.infer<typeof exceptionSchema>;
export type ExceptionRow = z.infer<typeof exceptionRowSchema>;
export type ExceptionEvent = z.infer<typeof exceptionEventSchema>;
export type TriageSuggestion = z.infer<typeof triageSuggestionSchema>;
export type ExceptionDetail = z.infer<typeof exceptionDetailSchema>;
export type QuarantineRow = z.infer<typeof quarantineSchema>;
export type SourceSummary = z.infer<typeof sourceSummarySchema>;
export type RunDiff = z.infer<typeof runDiffSchema>;
export type Me = z.infer<typeof meSchema>;
