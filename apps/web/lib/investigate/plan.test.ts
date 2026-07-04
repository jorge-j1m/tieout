import { describe, expect, it } from "vitest";
import type { InvestigationMessage } from "@tieout/contracts";
import { authorizeInvestigation, planTurn, turnRequestSchema } from "./plan";

function msg(id: string, role: "user" | "assistant", text: string): InvestigationMessage {
  return {
    id,
    role,
    authorName: role === "user" ? "ana" : "Clara",
    text,
    parts: [],
    citations: [],
    toolTrail: [],
    model: null,
    promptVersion: null,
    supersedesId: null,
    createdAt: "2026-07-04T00:00:00.000Z",
  };
}

const ask = (text: string) => turnRequestSchema.parse({ intent: "ask", text });
const edit = (text: string) => turnRequestSchema.parse({ intent: "edit", text });
const retry = () => turnRequestSchema.parse({ intent: "retry" });

describe("planTurn", () => {
  it("ask: persists a new question and ends the context with it", () => {
    const live = [msg("u1", "user", "hi"), msg("a1", "assistant", "hello")];
    const res = planTurn(ask("where did this charge come from?"), live);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.userTurn).toEqual({
      text: "where did this charge come from?",
      supersedesId: null,
      eventKind: "created",
    });
    expect(res.plan.assistant).toEqual({ supersedesId: null, eventKind: "created" });
    expect(res.plan.contextMessages.at(-1)).toEqual({
      role: "user",
      content: "where did this charge come from?",
    });
    // prior turns are carried as context
    expect(res.plan.contextMessages.map((m) => m.content)).toEqual([
      "hi",
      "hello",
      "where did this charge come from?",
    ]);
  });

  it("ask: rejects an empty question", () => {
    expect(planTurn(ask("   "), [])).toEqual({ ok: false, error: "Ask a question to start." });
  });

  it("edit: supersedes the last question and the answer that followed it", () => {
    const live = [
      msg("u1", "user", "waht is this?"),
      msg("a1", "assistant", "an answer to the typo'd question"),
    ];
    const res = planTurn(edit("what is this?"), live);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.userTurn).toEqual({
      text: "what is this?",
      supersedesId: "u1",
      eventKind: "edited",
    });
    // the old answer is replaced by the coming one
    expect(res.plan.assistant).toEqual({ supersedesId: "a1", eventKind: "retried" });
    // both superseded turns are excluded from context; the new question ends it
    expect(res.plan.contextMessages).toEqual([{ role: "user", content: "what is this?" }]);
  });

  it("edit: with no prior question is rejected", () => {
    expect(planTurn(edit("x"), [])).toEqual({
      ok: false,
      error: "There is no question to edit yet.",
    });
  });

  it("retry: regenerates the last answer with the same question, no new user turn", () => {
    const live = [msg("u1", "user", "explain this break"), msg("a1", "assistant", "first take")];
    const res = planTurn(retry(), live);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.userTurn).toBeNull();
    expect(res.plan.assistant).toEqual({ supersedesId: "a1", eventKind: "retried" });
    expect(res.plan.question).toBe("explain this break");
    // old answer excluded; context ends with the question so the model re-answers
    expect(res.plan.contextMessages).toEqual([{ role: "user", content: "explain this break" }]);
  });

  it("retry: with no answer to regenerate is rejected", () => {
    expect(planTurn(retry(), [msg("u1", "user", "q")])).toEqual({
      ok: false,
      error: "There is no answer to retry.",
    });
  });

  it("bounds the context window and never leads with an assistant turn", () => {
    const live: InvestigationMessage[] = [];
    for (let i = 0; i < 30; i++) {
      live.push(msg(`u${i}`, "user", `q${i}`));
      live.push(msg(`a${i}`, "assistant", `a${i}`));
    }
    const res = planTurn(ask("latest"), live);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.contextMessages.length).toBeLessThanOrEqual(20);
    expect(res.plan.contextMessages[0]!.role).toBe("user");
    expect(res.plan.contextMessages.at(-1)).toEqual({ role: "user", content: "latest" });
  });
});

describe("authorizeInvestigation", () => {
  it("rejects the demo persona with 401", () => {
    expect(authorizeInvestigation({ operator: null, investigate: true, remaining: 10 })).toMatchObject(
      { ok: false, status: 401 },
    );
  });

  it("reports the feature off with 503", () => {
    expect(
      authorizeInvestigation({ operator: "ana", investigate: false, remaining: 10 }),
    ).toMatchObject({ ok: false, status: 503 });
  });

  it("reports an exhausted budget with 429", () => {
    expect(
      authorizeInvestigation({ operator: "ana", investigate: true, remaining: 0 }),
    ).toMatchObject({ ok: false, status: 429 });
  });

  it("admits a signed-in operator within budget", () => {
    expect(authorizeInvestigation({ operator: "ana", investigate: true, remaining: 1 })).toEqual({
      ok: true,
    });
  });
});
