import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { minorToDecimalString, parseDecimalToMinor } from "@tieout/core";
import { generateMercadiaDataset } from "./generate.js";
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
      [expected.matches.total, expected.matchedTransactions],
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

  it("how-it-works' worked examples quote real numbers from the dataset", () => {
    const text = doc("docs/how-it-works.md");
    const { ledgerEntries, stripeBalanceTransactions, pagolatFiles } = generateMercadiaDataset();
    const ledgerAmount = (entryId: string) =>
      ledgerEntries.find((e) => e.entryId === entryId)!.amount;
    const stripeAbs = (id: string) => {
      const amount = stripeBalanceTransactions.find((t) => t.id === id)!.amount;
      return minorToDecimalString(BigInt(Math.abs(amount)), "USD");
    };
    /** "2900.00" → "2,900.00" — pure string work; floats never touch money, tests included. */
    const thousands = (plain: string) => {
      const [whole, fraction] = plain.split(".") as [string, string];
      return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
    };

    // §6 grouped example: the 05-21 file's net sum and its USD booking.
    const pl21 = pagolatFiles.find((f) => f.fileName === "pagolat-2026-05-21.csv")!;
    const netSumMinor = pl21.content
      .split("\n")
      .filter((l) => l.startsWith("LINE;"))
      .reduce((n, l) => n + parseDecimalToMinor(l.split(";")[6]!, "MXN", "comma"), 0n);
    const netSum = thousands(minorToDecimalString(netSumMinor, "MXN"));
    expect(text, `§6 must quote the 05-21 net sum ${netSum} MXN`).toContain(`${netSum} MXN`);
    expect(text, "§6 must quote LED-2026-PL21's booked amount").toContain(
      `$${ledgerAmount("LED-2026-PL21")}`,
    );

    // Break-table examples: real planted amounts.
    expect(text).toContain(`$${ledgerAmount("LED-2026-NS01")}`); // 111.11
    expect(text).toContain(`$${ledgerAmount("LED-2026-0028-DUP")}`); // 85.99
    expect(text).toContain(`$${stripeAbs("txn_re_0014")}`); // 66.81
    expect(text).toContain(`$${stripeAbs("txn_fee_radar_0001")}`); // 8.50
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
