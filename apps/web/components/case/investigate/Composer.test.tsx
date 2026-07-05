import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

const base = {
  value: "",
  onChange: () => {},
  onSubmit: () => {},
  onStop: () => {},
  streaming: false,
  editing: false,
  note: null as string | null,
  suggestions: [] as string[],
};

describe("Composer", () => {
  it("is inert for a persona that cannot send, and shows the honest note", () => {
    render(
      <Composer
        {...base}
        canSend={false}
        note="Sign in as an operator to ask Clara."
        suggestions={["Where should the other side be?"]}
      />,
    );
    expect(screen.getByPlaceholderText(/Ask about this break/)).toBeDisabled();
    expect(screen.getByText(/Sign in as an operator/)).toBeInTheDocument();
    // Suggested starters are hidden when the composer is inert.
    expect(screen.queryByText(/Where should the other side be/)).toBeNull();
  });

  it("offers break-type starters that submit on click", () => {
    const onSubmit = vi.fn();
    render(
      <Composer
        {...base}
        canSend
        onSubmit={onSubmit}
        suggestions={["Is this a timing lag or a real break?"]}
      />,
    );
    fireEvent.click(screen.getByText("Is this a timing lag or a real break?"));
    expect(onSubmit).toHaveBeenCalledWith("Is this a timing lag or a real break?");
  });

  it("disables Ask until there is text, then sends the trimmed question", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Composer {...base} canSend value="" onSubmit={onSubmit} />);
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();

    rerender(<Composer {...base} canSend value="  where from?  " onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onSubmit).toHaveBeenCalledWith("where from?");
  });

  it("offers Stop while streaming instead of Ask", () => {
    const onStop = vi.fn();
    render(<Composer {...base} canSend streaming value="x" onStop={onStop} />);
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
  });
});
