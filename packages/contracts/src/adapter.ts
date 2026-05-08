import type { BatchKind } from "./canonical.js";
import type { NormalizeResult } from "./txn.js";

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
  records: LandedRecord[];
}

export interface LandContext {
  /** Overlapping fetch window (D12). File-based sources may land the whole unit regardless. */
  window: { from: Date; to: Date };
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
