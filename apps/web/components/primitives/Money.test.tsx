import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Money } from "./Money";

describe("Money", () => {
  it("renders the exact formatted amount", () => {
    render(<Money minor="6681" currency="USD" />);
    expect(screen.getByText("$66.81")).toBeInTheDocument();
  });

  it("renders negatives with the true minus sign", () => {
    render(<Money minor="-6681" currency="USD" />);
    expect(screen.getByText("−$66.81")).toBeInTheDocument();
  });

  it("sets tabular monospace figures", () => {
    render(<Money minor="290000" currency="MXN" />);
    expect(screen.getByText("2,900.00 MXN")).toHaveClass("figures");
  });
});
