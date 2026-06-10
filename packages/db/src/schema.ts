import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  BATCH_KINDS,
  BATCH_STATUSES,
  BREAK_TYPES,
  CANONICAL_TXN_TYPES,
  EXCEPTION_EVENT_KINDS,
  EXCEPTION_STATUSES,
  MATCH_KINDS,
  OUTBOX_TOPICS,
  QUARANTINE_STAGES,
  RUN_STATUSES,
  TXN_STATUSES,
} from "@tieout/contracts";

/**
 * The ingestion spine (D8): append-only, versioned. Financial rows are never
 * UPDATEd or DELETEd — the single sanctioned mutation is flipping
 * `transactions.isCurrent` / stamping `supersededAt` when a newer version lands.
 * Constraints here are correctness features, not decoration.
 */

export const canonicalTxnType = pgEnum("canonical_txn_type", CANONICAL_TXN_TYPES);
export const txnStatus = pgEnum("txn_status", TXN_STATUSES);
export const breakType = pgEnum("break_type", BREAK_TYPES);
export const matchKind = pgEnum("match_kind", MATCH_KINDS);
export const batchKind = pgEnum("batch_kind", BATCH_KINDS);
export const batchStatus = pgEnum("batch_status", BATCH_STATUSES);
export const runStatus = pgEnum("run_status", RUN_STATUSES);
export const quarantineStage = pgEnum("quarantine_stage", QUARANTINE_STAGES);
export const exceptionStatus = pgEnum("exception_status", EXCEPTION_STATUSES);
export const exceptionEventKind = pgEnum("exception_event_kind", EXCEPTION_EVENT_KINDS);
export const outboxTopic = pgEnum("outbox_topic", OUTBOX_TOPICS);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const ingestionBatches = pgTable(
  "ingestion_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    connection: text("connection").notNull(),
    kind: batchKind("kind").notNull(),
    externalRef: text("external_ref").notNull(),
    /** Unit-of-work key (source + window, file hash). Re-landing converges instead of duplicating. */
    idempotencyKey: text("idempotency_key").notNull(),
    contentHash: text("content_hash").notNull(),
    controlTotals: jsonb("control_totals"),
    status: batchStatus("status").notNull().default("landed"),
    /** Complete-unit key when the source re-delivers whole units (D8 tombstones). */
    unitKey: text("unit_key"),
    /** Where the raw file bytes were archived (MinIO), when the unit came from a file (D9). */
    archiveUrl: text("archive_url"),
    observedAt: timestamptz("observed_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ingestion_batches_idempotency_key_uq").on(t.idempotencyKey),
    index("ingestion_batches_source_observed_idx").on(t.source, t.observedAt),
    index("ingestion_batches_unit_key_idx").on(t.source, t.unitKey),
  ],
);

export const rawRecords = pgTable(
  "raw_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => ingestionBatches.id),
    source: text("source").notNull(),
    sourceAccount: text("source_account").notNull(),
    sourceId: text("source_id").notNull(),
    /** Append-only: a changed payload (new content hash) is version n+1, never an UPDATE. */
    version: integer("version").notNull(),
    contentHash: text("content_hash").notNull(),
    payload: jsonb("payload").notNull(),
    /** A disappearance marker: the identity vanished from a restated complete unit (D8). */
    isTombstone: boolean("is_tombstone").notNull().default(false),
    observedAt: timestamptz("observed_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("raw_records_identity_version_uq").on(
      t.source,
      t.sourceAccount,
      t.sourceId,
      t.version,
    ),
    index("raw_records_batch_idx").on(t.batchId),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Every transaction traces to the raw observation it was normalized from (D9). */
    rawId: uuid("raw_id")
      .notNull()
      .references(() => rawRecords.id),
    version: integer("version").notNull(),
    isCurrent: boolean("is_current").notNull(),
    supersededAt: timestamptz("superseded_at"),
    /** The source restated its unit without this record: it no longer exists there (D8). */
    isTombstone: boolean("is_tombstone").notNull().default(false),
    source: text("source").notNull(),
    sourceAccount: text("source_account").notNull(),
    sourceId: text("source_id").notNull(),
    sourceType: text("source_type").notNull(),
    type: canonicalTxnType("type").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    /**
     * Net of source-side fees when the source nets them in-record. NULL only on
     * rows normalized before the concept existed (semantically = amountMinor);
     * the sanctioned backfill is re-normalizing from raw, never an UPDATE.
     */
    netMinor: bigint("net_minor", { mode: "bigint" }),
    currency: text("currency").notNull(),
    occurredAt: timestamptz("occurred_at").notNull(),
    valueDate: date("value_date"),
    observedAt: timestamptz("observed_at").notNull(),
    account: text("account").notNull(),
    reference: text("reference"),
    /** Settlement/payout unit membership for grouped matching; the anchor's reference names it. */
    groupRef: text("group_ref"),
    status: txnStatus("status").notNull(),
    normalizerVersion: text("normalizer_version").notNull(),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    /** One current version per identity (D10). */
    uniqueIndex("transactions_current_identity_uq")
      .on(t.source, t.sourceAccount, t.sourceId)
      .where(sql`${t.isCurrent}`),
    /** Normalizing the same raw with the same normalizer twice is impossible by construction. */
    uniqueIndex("transactions_raw_normalizer_uq").on(t.rawId, t.normalizerVersion),
    index("transactions_currency_account_occurred_idx").on(t.currency, t.account, t.occurredAt),
    index("transactions_reference_idx").on(t.reference),
    index("transactions_group_ref_idx").on(t.source, t.groupRef),
  ],
);

export const quarantinedRecords = pgTable(
  "quarantined_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => ingestionBatches.id),
    rawId: uuid("raw_id").references(() => rawRecords.id),
    stage: quarantineStage("stage").notNull(),
    source: text("source").notNull(),
    sourceAccount: text("source_account"),
    sourceId: text("source_id"),
    normalizerVersion: text("normalizer_version"),
    /** Structured errors — quarantine is an exceptions surface, not a log file (D14). */
    errors: jsonb("errors").notNull(),
    payload: jsonb("payload"),
    observedAt: timestamptz("observed_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("quarantined_raw_normalizer_uq")
      .on(t.rawId, t.normalizerVersion)
      .where(sql`${t.rawId} IS NOT NULL`),
    index("quarantined_batch_idx").on(t.batchId),
  ],
);

export const sourceCursors = pgTable(
  "source_cursors",
  {
    source: text("source").notNull(),
    sourceAccount: text("source_account").notNull(),
    /** High-water mark of observed data; polls re-cover a lookback window behind it (D12). */
    watermark: timestamptz("watermark").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.source, t.sourceAccount] })],
);

export const reconRuns = pgTable("recon_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Watermark the run evaluated — with member versions, makes the run reproducible (D11). */
  asOf: timestamptz("as_of").notNull(),
  rulesetVersion: text("ruleset_version").notNull(),
  status: runStatus("status").notNull(),
  stats: jsonb("stats").notNull(),
  startedAt: timestamptz("started_at").notNull(),
  finishedAt: timestamptz("finished_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => reconRuns.id),
    rulesetVersion: text("ruleset_version").notNull(),
    kind: matchKind("kind").notNull(),
    /** What the ruleset applied: group key/sums, tolerance + delta, FX rate. Self-describing runs. */
    details: jsonb("details"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("matches_run_idx").on(t.runId)],
);

export const matchMembers = pgTable(
  "match_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id),
    /** Denormalized so the database itself forbids one transaction in two matches per run. */
    runId: uuid("run_id")
      .notNull()
      .references(() => reconRuns.id),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    transactionVersion: integer("transaction_version").notNull(),
  },
  (t) => [
    uniqueIndex("match_members_run_txn_uq").on(t.runId, t.transactionId),
    index("match_members_match_idx").on(t.matchId),
  ],
);

export const breaks = pgTable(
  "breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => reconRuns.id),
    type: breakType("type").notNull(),
    details: jsonb("details").notNull(),
    /**
     * Stable identity of the logical break across runs — what exceptions key on
     * (D18). NULL only on breaks persisted before the concept existed.
     */
    fingerprint: text("fingerprint"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("breaks_run_type_idx").on(t.runId, t.type),
    /** The same logical break cannot be reported twice within one run. */
    uniqueIndex("breaks_run_fingerprint_uq")
      .on(t.runId, t.fingerprint)
      .where(sql`${t.fingerprint} IS NOT NULL`),
  ],
);

/**
 * Transactional outbox (D17): written in the SAME transaction as the supersession
 * or tombstone it announces — no dual writes, the outbox is the only event
 * mechanism. Rows are never deleted; processing stamps `processedAt`.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topic: outboxTopic("topic").notNull(),
    /** Everything a consumer needs: identity, old/new transaction ids and versions. */
    payload: jsonb("payload").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    processedAt: timestamptz("processed_at"),
    /** The recon run that re-evaluated the world after this event, for the audit chain. */
    processedByRunId: uuid("processed_by_run_id").references(() => reconRuns.id),
  },
  (t) => [
    index("outbox_unprocessed_idx")
      .on(t.createdAt)
      .where(sql`${t.processedAt} IS NULL`),
  ],
);

/**
 * The human-facing exception over a recurring logical break (D18). The row is a
 * mutable workflow pointer (like `isCurrent` — sanctioned); every change is
 * recorded in append-only `exception_events`. Identity = break fingerprint.
 */
export const exceptions = pgTable(
  "exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fingerprint: text("fingerprint").notNull(),
    type: breakType("type").notNull(),
    status: exceptionStatus("status").notNull(),
    /** First and most recent runs that reported the underlying break. */
    firstSeenRunId: uuid("first_seen_run_id")
      .notNull()
      .references(() => reconRuns.id),
    lastSeenRunId: uuid("last_seen_run_id")
      .notNull()
      .references(() => reconRuns.id),
    /** The most recent break row carrying full details. */
    currentBreakId: uuid("current_break_id")
      .notNull()
      .references(() => breaks.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("exceptions_fingerprint_uq").on(t.fingerprint),
    index("exceptions_status_idx").on(t.status),
  ],
);

/** Append-only history of an exception — who did what, when, why (D18). */
export const exceptionEvents = pgTable(
  "exception_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    exceptionId: uuid("exception_id")
      .notNull()
      .references(() => exceptions.id),
    kind: exceptionEventKind("kind").notNull(),
    /** Human (login/email) or "system" for run-driven transitions. */
    actor: text("actor").notNull(),
    note: text("note"),
    /** The run that triggered a system transition, when there is one. */
    runId: uuid("run_id").references(() => reconRuns.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("exception_events_exception_idx").on(t.exceptionId, t.createdAt)],
);

/**
 * FX rates as data (D7): conversion happens at match time with an explicit,
 * recorded rate. Rates are upserted by date — one rate per (base, quote, day,
 * source); runs record which rate they applied on each cross-currency match.
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    /** Decimal string, parsed with bigint arithmetic — never a float. */
    rate: text("rate").notNull(),
    rateSource: text("rate_source").notNull(),
    rateDate: date("rate_date").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fx_rates_pair_date_source_uq").on(t.base, t.quote, t.rateDate, t.rateSource)],
);
