import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { NormalizeResult, SourceAdapter } from "@tieout/contracts";

export const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));

const OBSERVED_AT = new Date("2026-06-01T00:00:00Z");
const WINDOW = { from: new Date("2026-05-01T00:00:00Z"), to: OBSERVED_AT };

function serializeResult(result: NormalizeResult): unknown {
  if (!result.ok) return { ok: false, errors: result.errors };
  const { txn } = result;
  return {
    ok: true,
    txn: {
      ...txn,
      amountMinor: txn.amountMinor.toString(),
      occurredAt: txn.occurredAt.toISOString(),
    },
  };
}

/**
 * Golden-file test (D16): land the fixture, normalize every record, compare against
 * the committed expected output. Regenerate with UPDATE_GOLDEN=1 after intentional
 * changes, then review the diff like any other code change.
 */
export async function expectGolden(adapter: SourceAdapter, expectedFile: string): Promise<void> {
  const batches = await adapter.land({ window: WINDOW });
  const actual = batches.flatMap((batch) =>
    batch.records.map((record) => ({
      sourceId: record.sourceId,
      result: serializeResult(
        adapter.normalize({
          source: batch.source,
          sourceAccount: record.sourceAccount,
          sourceId: record.sourceId,
          payload: record.payload,
          observedAt: OBSERVED_AT,
        }),
      ),
    })),
  );

  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(expectedFile)) {
    writeFileSync(expectedFile, `${JSON.stringify(actual, null, 2)}\n`);
  }
  expect(actual).toEqual(JSON.parse(readFileSync(expectedFile, "utf8")));
}
