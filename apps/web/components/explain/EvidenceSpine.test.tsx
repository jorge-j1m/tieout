import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { missingInLedger } from "@/lib/explain/fixtures";
import { EvidenceSpine } from "./EvidenceSpine";

const run = { id: "8905945c-0000-4000-8000-000000000000", asOf: "2026-06-05T00:00:00.000Z", rulesetVersion: "ruleset-v2" };

describe("EvidenceSpine", () => {
  it("renders all five numbered hops in order", () => {
    render(<EvidenceSpine brk={missingInLedger} transaction={null} raw={null} run={run} />);
    for (const title of [
      "Conclusion",
      "What matching tried",
      "The transaction",
      "The raw record",
      "The ingestion batch",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("shows the gloss and names the run on the conclusion hop", () => {
    render(<EvidenceSpine brk={missingInLedger} transaction={null} raw={null} run={run} />);
    expect(screen.getByText(/Money moved at the processor/)).toBeInTheDocument();
    expect(screen.getByText(/ruleset-v2/)).toBeInTheDocument();
  });
});
