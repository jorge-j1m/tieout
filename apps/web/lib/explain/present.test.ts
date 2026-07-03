import { describe, expect, it } from "vitest";
import {
  amountMismatch,
  duplicateCandidate,
  fxDrift,
  missingInLedger,
  missingInSource,
  unexpectedFee,
} from "./fixtures";
import { buildEvidenceChain, headlineFor, matchingNarrative } from "./present";

describe("matchingNarrative — derived from break facts, never stored", () => {
  it("missing_in_ledger names the uncited reference and ends in a break", () => {
    const steps = matchingNarrative(missingInLedger);
    expect(steps[0]).toMatchObject({ pass: true }); // survived the duplicate sweep
    expect(steps.some((s) => s.detail.includes("ch_mercadia_0014"))).toBe(true);
    expect(steps.at(-1)!.pass).toBe(false);
    expect(steps.at(-1)!.detail.toLowerCase()).toContain("break");
  });

  it("missing_in_source speaks of the source side", () => {
    const steps = matchingNarrative(missingInSource);
    expect(steps.some((s) => s.detail.toLowerCase().includes("source"))).toBe(true);
  });

  it("amount_mismatch states the delta and cites tolerance, without inventing a number", () => {
    const steps = matchingNarrative(amountMismatch);
    const paired = steps.find((s) => s.pass);
    expect(paired!.detail).toContain("ord_mercadia_0030");
    const toleranceStep = steps.find((s) => s.detail.toLowerCase().includes("tolerance"))!;
    expect(toleranceStep.detail).toContain("$7.50"); // |$500.00 − $492.50|
    expect(toleranceStep.pass).toBe(false);
  });

  it("duplicate_candidate explains the double post and the resolution", () => {
    const steps = matchingNarrative(duplicateCandidate);
    expect(steps[0]!.detail).toContain("ord_mercadia_0028");
    expect(steps.some((s) => s.detail.toLowerCase().includes("kept"))).toBe(true);
  });

  it("unexpected_fee cites a fee schedule check", () => {
    const steps = matchingNarrative(unexpectedFee);
    expect(steps.some((s) => s.detail.toLowerCase().includes("fee"))).toBe(true);
    expect(steps.at(-1)!.pass).toBe(false);
  });

  it("fx_drift makes the rate the suspect", () => {
    const steps = matchingNarrative(fxDrift);
    expect(steps.some((s) => s.detail.includes("0.0588"))).toBe(true);
    expect(steps[0]!.pass).toBe(true); // grouped-reference pass survived
    expect(steps.at(-1)!.pass).toBe(false);
  });
});

describe("headlineFor — plain English, ids and amounts", () => {
  it("missing_in_ledger names the refund and its amount", () => {
    const h = headlineFor(missingInLedger);
    expect(h).toContain("txn_re_0014");
    expect(h).toContain("$66.81");
    expect(h.toLowerCase()).toContain("ledger");
  });

  it("missing_in_source names the ledger entry and its amount", () => {
    const h = headlineFor(missingInSource);
    expect(h).toContain("LED-2026-NS01");
    expect(h).toContain("$111.11");
  });

  it("duplicate_candidate says it appears twice", () => {
    expect(headlineFor(duplicateCandidate).toLowerCase()).toContain("twice");
  });
});

describe("buildEvidenceChain — the provenance spine, in order", () => {
  it("yields conclusion → matching → transaction → raw → batch", () => {
    const hops = buildEvidenceChain({ break: missingInLedger, transaction: null, raw: null });
    expect(hops.map((h) => h.kind)).toEqual([
      "conclusion",
      "matching",
      "transaction",
      "raw",
      "batch",
    ]);
  });

  it("carries the gloss on the conclusion hop and the steps on the matching hop", () => {
    const hops = buildEvidenceChain({ break: missingInLedger, transaction: null, raw: null });
    const conclusion = hops.find((h) => h.kind === "conclusion")!;
    const matching = hops.find((h) => h.kind === "matching")!;
    expect(conclusion.kind === "conclusion" && conclusion.gloss).toContain("processor");
    expect(matching.kind === "matching" && matching.steps.length).toBeGreaterThan(0);
  });
});
