import { z } from "zod";
import { INVESTIGATION_QUESTION_MAX, type InvestigationMessage } from "@tieout/contracts";

/**
 * Pure turn planning for the investigation route handler — no I/O, so the edit /
 * retry / append-only rules are unit-testable without a model or a database.
 *
 * The thread is one shared, append-only conversation (D38). Edit and retry act on
 * the latest turn (v1): an edit supersedes the operator's last question (and the
 * answer that followed it); a retry regenerates the last answer, superseding it,
 * with the same question. Nothing is mutated — the superseding rows carry
 * `supersedesId`, and the live view drops what they replace.
 */

/** Recent turns kept as model context — bounds token spend and keeps Clara focused. */
export const INVESTIGATION_MODEL_CONTEXT_MAX = 20;

export const turnRequestSchema = z.object({
  intent: z.enum(["ask", "edit", "retry"]).default("ask"),
  text: z.string().max(INVESTIGATION_QUESTION_MAX).optional(),
});
export type TurnRequest = z.infer<typeof turnRequestSchema>;

/** A chat-completions message (the shape `streamText({ messages })` accepts). */
export interface ModelMessage {
  role: "user" | "assistant";
  content: string;
}

export interface UserTurnPlan {
  text: string;
  supersedesId: string | null;
  eventKind: "created" | "edited";
}
export interface AssistantTurnPlan {
  supersedesId: string | null;
  eventKind: "created" | "retried";
}
export interface TurnPlan {
  question: string;
  contextMessages: ModelMessage[];
  /** The operator turn to persist before streaming; null for a retry (the question stands). */
  userTurn: UserTurnPlan | null;
  /** How to persist Clara's answer in `onFinish`. */
  assistant: AssistantTurnPlan;
}
export type PlanResult = { ok: true; plan: TurnPlan } | { ok: false; error: string };

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i]!)) return i;
  }
  return -1;
}

export function planTurn(req: TurnRequest, live: InvestigationMessage[]): PlanResult {
  const lastUserIdx = findLastIndex(live, (m) => m.role === "user");
  const lastAssistantIdx = findLastIndex(live, (m) => m.role === "assistant");
  const exclude = new Set<string>();
  let question: string;
  let userTurn: UserTurnPlan | null = null;
  let assistant: AssistantTurnPlan = { supersedesId: null, eventKind: "created" };

  if (req.intent === "ask") {
    const text = req.text?.trim();
    if (!text) return { ok: false, error: "Ask a question to start." };
    question = text;
    userTurn = { text, supersedesId: null, eventKind: "created" };
  } else if (req.intent === "edit") {
    const text = req.text?.trim();
    if (!text) return { ok: false, error: "The edited question is empty." };
    if (lastUserIdx === -1) return { ok: false, error: "There is no question to edit yet." };
    const oldQuestion = live[lastUserIdx]!;
    exclude.add(oldQuestion.id);
    userTurn = { text, supersedesId: oldQuestion.id, eventKind: "edited" };
    // An answer already given to the old question is replaced by the new one.
    if (lastAssistantIdx > lastUserIdx) {
      const oldAnswer = live[lastAssistantIdx]!;
      exclude.add(oldAnswer.id);
      assistant = { supersedesId: oldAnswer.id, eventKind: "retried" };
    }
    question = text;
  } else {
    if (lastAssistantIdx === -1) return { ok: false, error: "There is no answer to retry." };
    if (lastUserIdx === -1 || lastUserIdx > lastAssistantIdx) {
      return { ok: false, error: "There is no question to retry." };
    }
    const oldAnswer = live[lastAssistantIdx]!;
    exclude.add(oldAnswer.id);
    assistant = { supersedesId: oldAnswer.id, eventKind: "retried" };
    question = live[lastUserIdx]!.text;
  }

  const kept: ModelMessage[] = live
    .filter((m) => !exclude.has(m.id))
    .map((m) => ({ role: m.role, content: m.text }));
  // For ask/edit the new question isn't in `live` yet; retry's question already is.
  const withQuestion: ModelMessage[] =
    req.intent === "retry" ? kept : [...kept, { role: "user", content: question }];
  // Keep the recent window; the model context must lead with a user turn.
  let contextMessages = withQuestion.slice(-INVESTIGATION_MODEL_CONTEXT_MAX);
  while (contextMessages.length > 0 && contextMessages[0]!.role === "assistant") {
    contextMessages = contextMessages.slice(1);
  }
  return { ok: true, plan: { question, contextMessages, userTurn, assistant } };
}

export type InvestigationAuth =
  | { ok: true }
  | { ok: false; status: 401 | 429 | 503; error: string };

/**
 * The stacked spend gate, as a pure decision: only a signed-in operator streams,
 * only when the feature is on, only while the daily budget holds. The web config
 * (which holds the key) is authoritative for `investigate`.
 */
export function authorizeInvestigation(input: {
  operator: string | null;
  investigate: boolean;
  remaining: number;
}): InvestigationAuth {
  if (input.operator === null) {
    return { ok: false, status: 401, error: "Sign in as an operator to investigate." };
  }
  if (!input.investigate) {
    return { ok: false, status: 503, error: "Live investigation is off on this deployment." };
  }
  if (input.remaining <= 0) {
    return {
      ok: false,
      status: 429,
      error: "Today's investigation budget is spent. It resets in a few hours.",
    };
  }
  return { ok: true };
}
