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
  MATCH_KINDS,
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
    observedAt: timestamptz("observed_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ingestion_batches_idempotency_key_uq").on(t.idempotencyKey),
    index("ingestion_batches_source_observed_idx").on(t.source, t.observedAt),
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
    source: text("source").notNull(),
    sourceAccount: text("source_account").notNull(),
    sourceId: text("source_id").notNull(),
    sourceType: text("source_type").notNull(),
    type: canonicalTxnType("type").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    occurredAt: timestamptz("occurred_at").notNull(),
    valueDate: date("value_date"),
    observedAt: timestamptz("observed_at").notNull(),
    account: text("account").notNull(),
    reference: text("reference"),
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
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("breaks_run_type_idx").on(t.runId, t.type)],
);
