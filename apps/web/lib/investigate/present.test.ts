import { describe, expect, it } from "vitest";
import { BREAK_TYPES, type InvestigationMessage } from "@tieout/contracts";
import {
  consultedFromParts,
  liveVerifiedIds,
  suggestedPrompts,
  textOf,
  toUiMessages,
  traceFromParts,
} from "./present";

const toolPart = (
  tool: string,
  opts: { input?: unknown; output?: unknown; done?: boolean },
) => ({
  type: `tool-${tool}`,
  state: opts.done === false ? "input-available" : "output-available",
  input: opts.input,
  output: opts.output,
});

describe("suggestedPrompts", () => {
  it("offers starters for every break type", () => {
    for (const type of BREAK_TYPES) {
      expect(suggestedPrompts(type).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("toUiMessages", () => {
  it("seeds ids, text parts, and metadata for attribution and citations", () => {
    const msg: InvestigationMessage = {
      id: "m1",
      role: "assistant",
      authorName: "Clara",
      text: "It settled late.",
      parts: [],
      citations: [{ kind: "raw", id: "r1", label: "stripe raw" }],
      toolTrail: [{ tool: "get_raw", ref: "r1" }],
      model: "claude-sonnet-5",
      promptVersion: "investigate-v1",
      supersedesId: null,
      createdAt: "2026-07-04T00:00:00.000Z",
    };
    const [ui] = toUiMessages([msg]);
    expect(ui!.id).toBe("m1");
    expect(ui!.parts).toEqual([{ type: "text", text: "It settled late." }]);
    expect(ui!.metadata).toMatchObject({
      authorName: "Clara",
      citations: [{ kind: "raw", id: "r1", label: "stripe raw" }],
      model: "claude-sonnet-5",
    });
  });
});

describe("reading the live tool stream", () => {
  it("textOf joins the text parts", () => {
    const parts = [
      { type: "text", text: "a" },
      { type: "step-start" },
      { type: "text", text: "b" },
    ];
    expect(textOf({ parts })).toBe("ab");
  });

  it("traceFromParts lists calls in order with their done state", () => {
    const parts = [
      toolPart("get_transaction", { input: { id: "t1" }, output: { id: "t1" } }),
      toolPart("get_raw", { input: { id: "r1" }, done: false }),
    ];
    expect(traceFromParts(parts)).toEqual([
      { tool: "get_transaction", ref: "t1", done: true },
      { tool: "get_raw", ref: "r1", done: false },
    ]);
  });

  it("liveVerifiedIds is seeds plus tool-returned ids — a miss (string output) is never verified", () => {
    const parts = [
      toolPart("get_transaction", { input: { id: "t1" }, output: { id: "t1", source: "stripe" } }),
      toolPart("get_raw", { input: { id: "missing" }, output: "No raw record with id missing." }),
      toolPart("get_run_diff", { input: { id: "run1" }, output: { runId: "run1" } }),
    ];
    const ids = liveVerifiedIds(parts, ["exc1", "brk1"]);
    expect([...ids].sort()).toEqual(["brk1", "exc1", "run1", "t1"].sort());
    expect(ids.has("missing")).toBe(false);
  });

  it("consultedFromParts builds labelled citations from tool outputs, skipping misses", () => {
    const parts = [
      toolPart("get_transaction", { input: { id: "t1" }, output: { id: "t1", source: "stripe", sourceId: "ch_1" } }),
      toolPart("get_sources", { output: [{ source: "stripe" }] }),
      toolPart("get_raw", { input: { id: "x" }, output: "No raw record with id x." }),
    ];
    expect(consultedFromParts(parts)).toEqual([
      { kind: "transaction", id: "t1", label: "stripe ch_1" },
    ]);
  });
});
