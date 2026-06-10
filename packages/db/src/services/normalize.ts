import { and, asc, eq, inArray } from "drizzle-orm";
import type { OutboxTopic, SourceAdapter } from "@tieout/contracts";
import { contentHash } from "@tieout/core";
import type { Db } from "../client.js";
import { ingestionBatches, outbox, quarantinedRecords, rawRecords, transactions } from "../schema.js";

export interface NormalizeBatchResult {
  batchId: string;
  normalized: number;
  quarantined: number;
  skipped: number;
  superseded: number;
  /** Re-translations whose output already exists verbatim — no new version written (D26). */
  unchanged: number;
  /** Tombstone raw versions turned into tombstone transaction versions (D8). */
  tombstoned: number;
}

/**
 * Canonical projection of a translation result — what "the same output" means.
 * Excludes bookkeeping (version, observedAt, normalizerVersion): two translator
 * versions producing this same projection from the same raw record carry no new
 * information, so no new transaction version is warranted (D26).
 *
 * `netMinor` is canonicalized to its meaning (`?? amountMinor`): rows written
 * before the field existed hash identically to re-translations that now spell
 * the same net out, so a version bump re-versions only records whose net
 * actually differs from their amount.
 */
function outputHash(t: {
  source: string;
  sourceAccount: string;
  sourceId: string;
  sourceType: string;
  type: string;
  amountMinor: bigint;
  netMinor: bigint | null;
  currency: string;
  occurredAt: Date;
  valueDate: string | null;
  account: string;
  reference: string | null;
  groupRef: string | null;
  status: string;
  metadata: unknown;
}): string {
  return contentHash({
    source: t.source,
    sourceAccount: t.sourceAccount,
    sourceId: t.sourceId,
    sourceType: t.sourceType,
    type: t.type,
    amountMinor: t.amountMinor.toString(),
    netMinor: (t.netMinor ?? t.amountMinor).toString(),
    currency: t.currency,
    occurredAt: t.occurredAt.toISOString(),
    valueDate: t.valueDate,
    account: t.account,
    reference: t.reference,
    groupRef: t.groupRef,
    status: t.status,
    metadata: t.metadata,
  });
}

/**
 * Normalize every raw record of a batch that this normalizer version hasn't
 * processed yet. Output is versioned: a new transaction for an identity that
 * already has a current one supersedes it (isCurrent flip — the only sanctioned
 * mutation, D8). Failures become structured quarantine rows, never guesses (D14).
 * Re-translations whose canonical output already exists for the same raw write
 * nothing (D26). Idempotent via the (rawId, normalizerVersion) uniqueness on
 * both written outputs; unchanged skips are recomputed (pure, cheap) on re-runs.
 */
export interface NormalizeOptions {
  /**
   * Failure-rate circuit breaker (D14): when more than this fraction of a batch's
   * pending records quarantine, the batch halts — quarantine rows are written (the
   * worklist), but no transactions: a batch failing this hard usually means the
   * feed drifted, and the "parseable" remainder is not to be trusted either.
   */
  maxQuarantineRate?: number;
}

export async function normalizeBatch(
  db: Db,
  adapter: SourceAdapter,
  batchId: string,
  now: Date,
  options: NormalizeOptions = {},
): Promise<NormalizeBatchResult> {
  const maxQuarantineRate = options.maxQuarantineRate ?? 0.5;
  return db.transaction(async (tx) => {
    const raws = await tx
      .select()
      .from(rawRecords)
      .where(eq(rawRecords.batchId, batchId))
      .orderBy(asc(rawRecords.sourceAccount), asc(rawRecords.sourceId), asc(rawRecords.version));

    if (raws.length === 0) {
      await tx
        .update(ingestionBatches)
        .set({ status: "normalized" })
        .where(eq(ingestionBatches.id, batchId));
      return {
        batchId,
        normalized: 0,
        quarantined: 0,
        skipped: 0,
        superseded: 0,
        unchanged: 0,
        tombstoned: 0,
      };
    }

    const rawIds = raws.map((r) => r.id);
    const processed = new Set<string>();
    for (const row of await tx
      .select({ rawId: transactions.rawId })
      .from(transactions)
      .where(
        and(
          inArray(transactions.rawId, rawIds),
          eq(transactions.normalizerVersion, adapter.normalizerVersion),
        ),
      )) {
      processed.add(row.rawId);
    }
    for (const row of await tx
      .select({ rawId: quarantinedRecords.rawId })
      .from(quarantinedRecords)
      .where(
        and(
          inArray(quarantinedRecords.rawId, rawIds),
          eq(quarantinedRecords.normalizerVersion, adapter.normalizerVersion),
        ),
      )) {
      if (row.rawId !== null) processed.add(row.rawId);
    }

    const pending = raws.filter((r) => !processed.has(r.id));
    const skipped = raws.length - pending.length;

    // Prior translations of the pending raws (any normalizer version). A re-translation
    // whose canonical output already exists for the same raw writes nothing — the audit
    // trail records change, not activity (D26). Restatements always carry a new raw row,
    // so they always version.
    const priorOutputsByRaw = new Map<string, Set<string>>();
    if (pending.length > 0) {
      const prior = await tx
        .select({
          rawId: transactions.rawId,
          source: transactions.source,
          sourceAccount: transactions.sourceAccount,
          sourceId: transactions.sourceId,
          sourceType: transactions.sourceType,
          type: transactions.type,
          amountMinor: transactions.amountMinor,
          netMinor: transactions.netMinor,
          currency: transactions.currency,
          occurredAt: transactions.occurredAt,
          valueDate: transactions.valueDate,
          account: transactions.account,
          reference: transactions.reference,
          groupRef: transactions.groupRef,
          status: transactions.status,
          metadata: transactions.metadata,
        })
        .from(transactions)
        .where(
          inArray(
            transactions.rawId,
            pending.map((r) => r.id),
          ),
        );
      for (const p of prior) {
        const hashes = priorOutputsByRaw.get(p.rawId) ?? new Set<string>();
        hashes.add(outputHash(p));
        priorOutputsByRaw.set(p.rawId, hashes);
      }
    }

    // Current transaction per affected identity, for version chaining, supersession,
    // and the canonical fields a tombstone version carries forward.
    type CurrentTxn = {
      id: string;
      sourceAccount: string;
      sourceId: string;
      version: number;
      sourceType: string;
      type: (typeof transactions.$inferSelect)["type"];
      amountMinor: bigint;
      netMinor: bigint | null;
      currency: string;
      occurredAt: Date;
      valueDate: string | null;
      account: string;
      reference: string | null;
      groupRef: string | null;
      status: (typeof transactions.$inferSelect)["status"];
      metadata: unknown;
    };
    const currentByKey = new Map<string, CurrentTxn>();
    if (pending.length > 0) {
      const currents = await tx
        .select({
          id: transactions.id,
          sourceAccount: transactions.sourceAccount,
          sourceId: transactions.sourceId,
          version: transactions.version,
          sourceType: transactions.sourceType,
          type: transactions.type,
          amountMinor: transactions.amountMinor,
          netMinor: transactions.netMinor,
          currency: transactions.currency,
          occurredAt: transactions.occurredAt,
          valueDate: transactions.valueDate,
          account: transactions.account,
          reference: transactions.reference,
          groupRef: transactions.groupRef,
          status: transactions.status,
          metadata: transactions.metadata,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.source, adapter.source),
            eq(transactions.isCurrent, true),
            inArray(transactions.sourceId, [...new Set(pending.map((r) => r.sourceId))]),
          ),
        );
      for (const c of currents) {
        currentByKey.set(`${c.sourceAccount} ${c.sourceId}`, c);
      }
    }

    const txnRows: (typeof transactions.$inferInsert)[] = [];
    const quarantineRows: (typeof quarantinedRecords.$inferInsert)[] = [];
    const supersededIds: string[] = [];
    // Outbox events planned against row indexes; ids resolve after the insert
    // returns them — same transaction, no dual write (D17).
    const outboxPlan: {
      txnIdx: number;
      topic: OutboxTopic;
      old: { existing: { id: string; version: number } } | { builtIdx: number };
    }[] = [];
    let unchanged = 0;
    // Tracks the last row built per identity within this call, so multiple pending
    // versions of one identity chain correctly and only the last stays current.
    const lastBuiltByKey = new Map<string, number>();

    let tombstoned = 0;
    for (const raw of pending) {
      if (raw.isTombstone) {
        // The source restated its unit without this identity. The tombstone version
        // carries the predecessor's canonical fields forward and marks the end of
        // the line; an identity that never reached canonical space (all versions
        // quarantined) has nothing to tombstone — the quarantine rows are its story.
        const key = `${raw.sourceAccount} ${raw.sourceId}`;
        const current = currentByKey.get(key);
        if (current === undefined) continue;
        supersededIds.push(current.id);
        outboxPlan.push({
          txnIdx: txnRows.length,
          topic: "transaction.tombstoned",
          old: { existing: { id: current.id, version: current.version } },
        });
        txnRows.push({
          rawId: raw.id,
          version: current.version + 1,
          isCurrent: true,
          isTombstone: true,
          createdAt: now,
          supersededAt: null,
          source: raw.source,
          sourceAccount: current.sourceAccount,
          sourceId: current.sourceId,
          sourceType: current.sourceType,
          type: current.type,
          amountMinor: current.amountMinor,
          netMinor: current.netMinor,
          currency: current.currency,
          occurredAt: current.occurredAt,
          valueDate: current.valueDate,
          observedAt: raw.observedAt,
          account: current.account,
          reference: current.reference,
          groupRef: current.groupRef,
          status: current.status,
          normalizerVersion: adapter.normalizerVersion,
          metadata: current.metadata,
        });
        tombstoned += 1;
        continue;
      }

      const result = adapter.normalize({
        source: raw.source,
        sourceAccount: raw.sourceAccount,
        sourceId: raw.sourceId,
        payload: raw.payload,
        observedAt: raw.observedAt,
      });

      if (!result.ok) {
        quarantineRows.push({
          batchId,
          rawId: raw.id,
          stage: "normalize",
          source: raw.source,
          sourceAccount: raw.sourceAccount,
          sourceId: raw.sourceId,
          normalizerVersion: adapter.normalizerVersion,
          errors: result.errors,
          payload: raw.payload,
          observedAt: raw.observedAt,
        });
        continue;
      }

      if (priorOutputsByRaw.get(raw.id)?.has(outputHash(result.txn))) {
        unchanged += 1;
        continue;
      }

      const key = `${raw.sourceAccount} ${raw.sourceId}`;
      const current = currentByKey.get(key);
      const builtIdx = lastBuiltByKey.get(key);
      if (builtIdx !== undefined) {
        // An earlier pending version of this identity is superseded within this call.
        txnRows[builtIdx]!.isCurrent = false;
        txnRows[builtIdx]!.supersededAt = now;
        outboxPlan.push({
          txnIdx: txnRows.length,
          topic: "transaction.superseded",
          old: { builtIdx },
        });
      } else if (current) {
        supersededIds.push(current.id);
        outboxPlan.push({
          txnIdx: txnRows.length,
          topic: "transaction.superseded",
          old: { existing: { id: current.id, version: current.version } },
        });
      }
      const version =
        builtIdx !== undefined ? txnRows[builtIdx]!.version + 1 : (current?.version ?? 0) + 1;

      const { txn } = result;
      txnRows.push({
        rawId: raw.id,
        version,
        isCurrent: true,
        // System-time validity: in effect from createdAt until supersededAt (D27).
        // `now` here is the same instant stamped on the predecessor's supersededAt.
        createdAt: now,
        supersededAt: null,
        source: txn.source,
        sourceAccount: txn.sourceAccount,
        sourceId: txn.sourceId,
        sourceType: txn.sourceType,
        type: txn.type,
        amountMinor: txn.amountMinor,
        netMinor: txn.netMinor,
        currency: txn.currency,
        occurredAt: txn.occurredAt,
        valueDate: txn.valueDate,
        observedAt: raw.observedAt,
        account: txn.account,
        reference: txn.reference,
        groupRef: txn.groupRef,
        status: txn.status,
        normalizerVersion: adapter.normalizerVersion,
        metadata: txn.metadata,
      });
      lastBuiltByKey.set(key, txnRows.length - 1);
    }

    if (pending.length > 0 && quarantineRows.length / pending.length > maxQuarantineRate) {
      // Circuit breaker (D14): a batch failing this hard means the feed drifted —
      // the parseable remainder is collateral, quarantined with an explicit reason
      // so nothing lingers half-processed and the halt survives retries.
      const quarantinedRawIds = new Set(quarantineRows.map((q) => q.rawId));
      for (const raw of pending) {
        if (quarantinedRawIds.has(raw.id)) continue;
        quarantineRows.push({
          batchId,
          rawId: raw.id,
          stage: "normalize",
          source: raw.source,
          sourceAccount: raw.sourceAccount,
          sourceId: raw.sourceId,
          normalizerVersion: adapter.normalizerVersion,
          errors: [
            {
              path: "batch",
              message: "not processed: batch halted by the quarantine-rate circuit breaker",
            },
          ],
          payload: raw.payload,
          observedAt: raw.observedAt,
        });
      }
      await tx.insert(quarantinedRecords).values(quarantineRows);
      await tx
        .update(ingestionBatches)
        .set({ status: "halted" })
        .where(eq(ingestionBatches.id, batchId));
      return {
        batchId,
        normalized: 0,
        quarantined: quarantineRows.length,
        skipped,
        superseded: 0,
        unchanged: 0,
        tombstoned: 0,
      };
    }

    if (supersededIds.length > 0) {
      await tx
        .update(transactions)
        .set({ isCurrent: false, supersededAt: now })
        .where(inArray(transactions.id, supersededIds));
    }
    let insertedTxns: { id: string }[] = [];
    if (txnRows.length > 0) {
      insertedTxns = await tx.insert(transactions).values(txnRows).returning({ id: transactions.id });
    }
    if (outboxPlan.length > 0) {
      await tx.insert(outbox).values(
        outboxPlan.map((plan) => {
          const row = txnRows[plan.txnIdx]!;
          const old =
            "existing" in plan.old
              ? plan.old.existing
              : { id: insertedTxns[plan.old.builtIdx]!.id, version: txnRows[plan.old.builtIdx]!.version };
          return {
            topic: plan.topic,
            // Same logical instant as the version it announces — the run that
            // covers this event compares against the data clock, not the wall.
            createdAt: now,
            payload: {
              source: row.source,
              sourceAccount: row.sourceAccount,
              sourceId: row.sourceId,
              oldTransactionId: old.id,
              oldVersion: old.version,
              newTransactionId: insertedTxns[plan.txnIdx]!.id,
              newVersion: row.version,
            },
          };
        }),
      );
    }
    if (quarantineRows.length > 0) {
      await tx.insert(quarantinedRecords).values(quarantineRows);
    }
    // A previously halted batch stays halted until something is actually pending
    // again (an adapter fix arrives as a normalizer version bump).
    if (pending.length > 0) {
      await tx
        .update(ingestionBatches)
        .set({ status: "normalized" })
        .where(eq(ingestionBatches.id, batchId));
    }

    return {
      batchId,
      normalized: txnRows.length - tombstoned,
      quarantined: quarantineRows.length,
      skipped,
      superseded: supersededIds.length,
      unchanged,
      tombstoned,
    };
  });
}
