import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginHint } from "./LoginHint";

afterEach(() => vi.unstubAllEnvs());

describe("LoginHint — the lent key, published only when configured", () => {
  it("shows the name and token under the double rule when DEMO_LOGIN_HINT is set", () => {
    vi.stubEnv("DEMO_LOGIN_HINT", "visitor:under-the-double-rule");
    render(<LoginHint />);
    expect(screen.getByText("visitor")).toBeInTheDocument();
    expect(screen.getByText("under-the-double-rule")).toBeInTheDocument();
    expect(screen.getByText(/under the double rule/i)).toBeInTheDocument();
  });

  it("renders nothing when unset — a private deployment advertises no key", () => {
    const { container } = render(<LoginHint />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["no-colon", ":token-only", "name-only:"])(
    "renders nothing for malformed %j rather than half a credential",
    (value) => {
      vi.stubEnv("DEMO_LOGIN_HINT", value);
      const { container } = render(<LoginHint />);
      expect(container).toBeEmptyDOMElement();
    },
  );
});
