import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StateChip } from "./StateChip";

// The one thing worth guarding here is a product requirement, not styling:
// a chip must always carry a text label, so color is never the sole signal.
describe("StateChip", () => {
  it("renders its text label", () => {
    render(<StateChip tone="break" label="Missing in ledger" />);
    expect(screen.getByText("Missing in ledger")).toBeInTheDocument();
  });
});
