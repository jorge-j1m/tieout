import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSeedManifest } from "./index.js";

/**
 * The docs quote the demo's numbers in several places. The manifest is the single
 * source of truth (D19); this test enumerates every quoted spot so a dataset change
 * fails the build until each doc agrees — the no-doc-rot rule, mechanized.
 */

const doc = (relToRepoRoot: string): string =>
  readFileSync(new URL(`../../../${relToRepoRoot}`, import.meta.url), "utf8");

const { expected, plantedBreaks } = loadSeedManifest();

function captured(text: string, re: RegExp, where: string): number[] {
  const m = text.match(re);
  expect(m, `${where}: expected to find ${re}`).not.toBeNull();
  return m!.slice(1).map(Number);
}

describe("docs quote the manifest's numbers", () => {
  it("how-it-works.md §7 sample output matches the manifest", () => {
    const text = doc("docs/how-it-works.md");
    expect(captured(text, /^\s+matches:\s+(\d+) \((\d+) transactions\)$/m, "how-it-works §7")).toEqual(
      [expected.matches.total, expected.matches.total * 2],
    );
    expect(captured(text, /^\s+breaks:\s+(\d+)$/m, "how-it-works §7")).toEqual([
      expected.totalBreaks,
    ]);
    for (const [type, count] of Object.entries(expected.breaksByType)) {
      expect(text, `how-it-works §7 break breakdown for ${type}`).toContain(
        `- ${type}: ${count}`,
      );
    }
    expect(captured(text, /^\s+ledger: .*?(\d+) unchanged/m, "how-it-works §7")).toEqual([
      expected.ledgerRecords,
    ]);
    expect(captured(text, /^\s+stripe: .*?(\d+) unchanged/m, "how-it-works §7")).toEqual([
      expected.stripeRecords,
    ]);
  });

  it("onboarding.md quotes the right match/break counts everywhere", () => {
    const text = doc("docs/onboarding.md");
    const pairs = [...text.matchAll(/(\d+) matches(?:,| \/) (\d+) breaks/g)];
    expect(pairs.length, "onboarding.md should quote the counts at least twice").toBeGreaterThanOrEqual(2);
    for (const m of pairs) {
      expect([Number(m[1]), Number(m[2])], `onboarding.md: "${m[0]}"`).toEqual([
        expected.matches.total,
        expected.totalBreaks,
      ]);
    }
    expect(captured(text, /expected breaks \((\d+),/, "onboarding.md §4")).toEqual([
      expected.totalBreaks,
    ]);
  });

  it("root README quotes the right match/break counts", () => {
    const text = doc("README.md");
    expect(
      captured(text, /\*\*(\d+) matches and exactly (\d+) breaks\*\*/, "README.md quickstart"),
    ).toEqual([expected.matches.total, expected.totalBreaks]);
  });

  it("seed README's story and break table match the manifest", () => {
    const text = doc("packages/seed/README.md");
    expect(captured(text, /(\d+) records match on exact reference/, "seed README")).toEqual([
      expected.matches.exact_reference,
    ]);
    expect(captured(text, /(\d+) manually-booked payments/, "seed README")).toEqual([
      expected.matches.amount_date_window,
    ]);
    const tableRows = text.match(/^\| \d+ \| `/gm) ?? [];
    expect(tableRows.length, "seed README break table rows").toBe(plantedBreaks.length);
  });
});
