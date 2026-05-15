import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../client.js";
import { matches, matchMembers, rawRecords, reconRuns, transactions } from "../schema.js";
import { connectMigrated, hasDatabase, insertFixtureRaw, truncateAll } from "./helpers.js";

const OBSERVED = new Date("2026-06-01T00:00:00Z");

/** Drizzle wraps driver errors; the violated constraint's name lives in the cause. */
async function expectConstraint(promise: Promise<unknown>, constraint: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as Error,
  );
  expect(error, `expected a violation of ${constraint}`).not.toBeNull();
  const cause = error!.cause as { constraint_name?: string; message?: string } | undefined;
  expect(`${cause?.constraint_name ?? ""} ${cause?.message ?? ""}`).toContain(constraint);
}

function txnRow(
  rawId: string,
  over: Partial<typeof transactions.$inferInsert> = {},
): typeof transactions.$inferInsert {
  return {
    rawId,
    version: 1,
    isCurrent: true,
    source: "ledger",
    sourceAccount: "acct_main",
    sourceId: "e1",
    sourceType: "payment",
    type: "payment",
    amountMinor: 1000n,
    currency: "USD",
    occurredAt: OBSERVED,
    valueDate: null,
    observedAt: OBSERVED,
    account: "main",
    reference: null,
    status: "settled",
    normalizerVersion: "v1",
    metadata: {},
    ...over,
  };
}

describe.skipIf(!hasDatabase)("schema constraints are correctness features", () => {
  let client: DbClient;

  beforeAll(async () => {
    client = await connectMigrated();
  });
  afterAll(async () => {
    await client.sql.end();
  });
  beforeEach(async () => {
    await truncateAll(client.db);
  });

  it("forbids two current transactions for one identity", async () => {
    const { db } = client;
    const a = await insertFixtureRaw(db, { source: "ledger", sourceAccount: "acct_main", sourceId: "e1" });
    const b = await insertFixtureRaw(db, { source: "ledger", sourceAccount: "acct_main", sourceId: "e1", version: 2 });
    await db.insert(transactions).values(txnRow(a.rawId));
    await expectConstraint(
      db.insert(transactions).values(txnRow(b.rawId, { version: 2 })),
      "transactions_current_identity_uq",
    );
    // Superseded versions of the same identity are fine.
    await db
      .insert(transactions)
      .values(txnRow(b.rawId, { version: 2, isCurrent: false, supersededAt: OBSERVED }));
  });

  it("forbids duplicate raw (source, sourceAccount, sourceId, version)", async () => {
    const { db } = client;
    const { batchId } = await insertFixtureRaw(db, {
      source: "stripe",
      sourceAccount: "acct",
      sourceId: "txn_1",
    });
    await expectConstraint(
      db.insert(rawRecords).values({
        batchId,
        source: "stripe",
        sourceAccount: "acct",
        sourceId: "txn_1",
        version: 1,
        contentHash: "different-content",
        payload: { fixture: true },
        observedAt: OBSERVED,
      }),
      "raw_records_identity_version_uq",
    );
  });

  it("forbids normalizing the same raw twice with one normalizer version", async () => {
    const { db } = client;
    const { rawId } = await insertFixtureRaw(db, { source: "ledger", sourceAccount: "acct_main", sourceId: "e1" });
    await db.insert(transactions).values(txnRow(rawId));
    await expectConstraint(
      db.insert(transactions).values(txnRow(rawId, { version: 2, isCurrent: false })),
      "transactions_raw_normalizer_uq",
    );
  });

  it("stores amounts beyond Number.MAX_SAFE_INTEGER without loss", async () => {
    const { db } = client;
    const { rawId } = await insertFixtureRaw(db, { source: "ledger", sourceAccount: "acct_main", sourceId: "big" });
    const amount = 9007199254740993n; // 2^53 + 1 — a float would silently corrupt this
    await db.insert(transactions).values(txnRow(rawId, { sourceId: "big", amountMinor: amount }));
    const [row] = await db.select({ amountMinor: transactions.amountMinor }).from(transactions);
    expect(row!.amountMinor).toBe(amount);
  });

  it("forbids one transaction in two matches within a run", async () => {
    const { db } = client;
    const { rawId } = await insertFixtureRaw(db, { source: "ledger", sourceAccount: "acct_main", sourceId: "e1" });
    const [txn] = await db.insert(transactions).values(txnRow(rawId)).returning({ id: transactions.id });
    const [run] = await db
      .insert(reconRuns)
      .values({ asOf: OBSERVED, rulesetVersion: "ruleset-v1", status: "completed", stats: {}, startedAt: OBSERVED })
      .returning({ id: reconRuns.id });
    const [m1] = await db
      .insert(matches)
      .values({ runId: run!.id, rulesetVersion: "ruleset-v1", kind: "exact_reference" })
      .returning({ id: matches.id });
    const [m2] = await db
      .insert(matches)
      .values({ runId: run!.id, rulesetVersion: "ruleset-v1", kind: "amount_date_window" })
      .returning({ id: matches.id });
    await db
      .insert(matchMembers)
      .values({ matchId: m1!.id, runId: run!.id, transactionId: txn!.id, transactionVersion: 1 });
    await expectConstraint(
      db
        .insert(matchMembers)
        .values({ matchId: m2!.id, runId: run!.id, transactionId: txn!.id, transactionVersion: 1 }),
      "match_members_run_txn_uq",
    );
  });
});
