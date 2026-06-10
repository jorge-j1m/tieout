import type { BatchKind } from "./canonical.js";
import type { NormalizeResult, QuarantineError } from "./txn.js";

/** One observation landed exactly as received. Plain JSON — never transformed at landing (D9). */
export interface LandedRecord {
  sourceAccount: string;
  sourceId: string;
  payload: unknown;
}

/** A unit of landing work. Content hashes and observedAt are stamped by ingestion, not the adapter. */
export interface LandedBatch {
  source: string;
  /** Which connection/credential produced this (multi-account is day-one reality). */
  connection: string;
  kind: BatchKind;
  /** Human-readable pointer to the unit: window descriptor, file name, ... */
  externalRef: string;
  /** Unit-of-work key (source + window, file hash). Re-landing the same unit converges (idempotent). */
  idempotencyKey: string;
  /** Source-declared integrity data (control totals, line counts) when the source provides it (D13). */
  controlTotals?: Record<string, unknown>;
  /**
   * Declared when this batch is the COMPLETE current content of a re-deliverable
   * unit (a settlement file that may be restated). Landing diffs it against the
   * unit's previous landing: identities that vanished get tombstone versions (D8).
   * Window-based API landings never set this — absence from a window means nothing.
   */
  completeUnit?: { key: string };
  /**
   * Set when the unit failed its OWN integrity checks (control totals, D13).
   * Landing quarantines the whole batch: no raw records, one batch-level
   * quarantine row carrying these errors. The file is suspect end to end —
   * landing half of a lying file would manufacture false breaks.
   */
  integrityFailure?: QuarantineError[];
  /** Where the unit's raw bytes were archived (D9) when an archiver was available. */
  archiveUrl?: string;
  records: LandedRecord[];
}

export interface LandContext {
  /** Overlapping fetch window (D12). File-based sources may land the whole unit regardless. */
  window: { from: Date; to: Date };
  /**
   * Archive a unit's raw bytes (MinIO in production), returning the stored URL.
   * Optional — tests and fixture-driven landings run without it; adapters that
   * land files call it when present and record the URL on the batch (D9).
   */
  archive?: (key: string, body: string) => Promise<string>;
}

/** A raw_records row handed to normalize. */
export interface RawForNormalize {
  source: string;
  sourceAccount: string;
  sourceId: string;
  payload: unknown;
  observedAt: Date;
}

/**
 * Every source implements this. `land` may do I/O; `normalize` must be pure and
 * deterministic — no I/O, no clock, same raw in, same result out.
 */
export interface SourceAdapter {
  readonly source: string;
  /** Bumped whenever normalize's behavior changes; fixes re-normalize from raw (D9). */
  readonly normalizerVersion: string;
  land(ctx: LandContext): Promise<LandedBatch[]>;
  normalize(raw: RawForNormalize): NormalizeResult;
}
