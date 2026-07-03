import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TriageSuggestion } from "@tieout/contracts";
import { TriageMargin } from "./TriageMargin";

const suggestion: TriageSuggestion = {
  id: "t1",
  exceptionId: "e1",
  breakId: "b1",
  inputHash: "h1",
  model: "claude-opus-4-8",
  promptVersion: "triage-v1",
  classification: "missing_counterpart",
  confidence: "high",
  explanation: "The processor recorded this but no ledger entry cites it.",
  suggestedAction: "Book the refund or confirm it was intentionally excluded.",
  createdAt: "2026-06-05T00:00:00.000Z",
};

describe("TriageMargin — a note, never part of the record", () => {
  it("carries the disclaimer, the next step, and the model footer", () => {
    render(<TriageMargin suggestion={suggestion} />);
    expect(screen.getByText(/never blocks, never edits/)).toBeInTheDocument();
    expect(screen.getByText(/Book the refund/)).toBeInTheDocument();
    expect(screen.getByText(/claude-opus-4-8/)).toBeInTheDocument();
  });
});
