import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DoubleRule } from "./DoubleRule";

describe("DoubleRule — the tied-out motif", () => {
  it("draws exactly two rules, heavy over light, hidden from readers", () => {
    const { container } = render(<DoubleRule />);
    const mark = container.firstElementChild!;
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark.children).toHaveLength(2);
    expect(mark.children[0]).toHaveClass("h-[2px]");
    expect(mark.children[1]).toHaveClass("h-px");
  });
});
