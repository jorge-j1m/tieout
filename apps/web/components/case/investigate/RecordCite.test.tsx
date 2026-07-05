import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CiteProvider } from "./citation-context";
import { RecordCite } from "./RecordCite";

const RUN = "33333333-3333-4333-8333-333333333333";
const TXN = "11111111-1111-4111-8111-111111111111";

function renderCite(href: string, verified: string[], breakId?: string) {
  return render(
    <CiteProvider value={{ verified: new Set(verified), breakId }}>
      <RecordCite href={href}>the record</RecordCite>
    </CiteProvider>,
  );
}

describe("RecordCite — a citation is a receipt, never a fabricated link", () => {
  it("links a verified run to its page", () => {
    renderCite(`cite:run:${RUN}`, [RUN]);
    const link = screen.getByRole("link", { name: /the record/ });
    expect(link).toHaveAttribute("href", `/runs/${RUN}`);
  });

  it("renders an unverified id as plain text — no link", () => {
    renderCite(`cite:run:${RUN}`, []); // not in the verified set
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("the record")).toBeInTheDocument();
  });

  it("links a verified transaction into the evidence chain when the break is known", () => {
    renderCite(`cite:transaction:${TXN}`, [TXN], "brk9");
    expect(screen.getByRole("link", { name: /the record/ })).toHaveAttribute("href", "/breaks/brk9");
  });

  it("shows a verified but page-less transaction as an unlinked mark", () => {
    renderCite(`cite:transaction:${TXN}`, [TXN]); // verified, but no break context
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("the record")).toBeInTheDocument();
  });

  it("never links a non-cite href", () => {
    renderCite("https://evil.example.com", []);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("the record")).toBeInTheDocument();
  });
});
