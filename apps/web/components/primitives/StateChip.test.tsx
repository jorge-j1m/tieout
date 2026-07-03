import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StateChip } from "./StateChip";

describe("StateChip — color never the sole signal", () => {
  it("always carries its text label", () => {
    render(<StateChip tone="break" label="Missing in ledger" />);
    expect(screen.getByText("Missing in ledger")).toBeInTheDocument();
  });

  it.each([
    ["break", "text-break"],
    ["matched", "text-matched"],
    ["pending", "text-pending"],
    ["muted", "text-muted"],
  ] as const)("tone %s renders in its token color", (tone, cls) => {
    render(<StateChip tone={tone} label={tone} />);
    expect(screen.getByText(tone)).toHaveClass(cls);
  });
});
