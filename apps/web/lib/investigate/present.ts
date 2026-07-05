import type { UIMessage } from "ai";
import type { BreakType, Citation, InvestigationMessage, ToolTrailEntry } from "@tieout/contracts";

/**
 * Pure, client-safe helpers for the investigation panel: seeding useChat from the
 * saved thread, the starter prompts per break type, and reading the live tool
 * stream. Kept out of the components so the citation/verification rules are
 * unit-testable without a browser.
 */

/** Metadata carried on a seeded (persisted) turn so the UI can attribute and cite it. */
export interface InvestigationMeta {
  authorName: string;
  createdAt: string;
  citations: Citation[];
  toolTrail: ToolTrailEntry[];
  supersedesId: string | null;
  model: string | null;
}
export type InvestigationUIMessage = UIMessage<InvestigationMeta>;

const STARTERS: Record<BreakType, string[]> = {
  missing_in_ledger: [
    "Where should the other side of this be?",
    "Is this a timing lag or a real break?",
  ],
  missing_in_stripe: [
    "Why would the source have no record of this?",
    "Is this a timing lag or a real break?",
  ],
  missing_in_source: [
    "Why would the source have no record of this?",
    "Is this a timing lag or a real break?",
  ],
  amount_mismatch: ["What explains the difference?", "Which side looks right?"],
  duplicate_candidate: ["Are these truly the same event?", "Which one should stand?"],
  unexpected_fee: ["What is this fee, and where did it come from?", "Should the books have expected it?"],
  fx_drift: ["Does the recorded rate explain the gap?", "Is this drift or a real break?"],
};

/** Two or three tappable openers for an empty thread — chosen by what broke. */
export function suggestedPrompts(type: BreakType): string[] {
  return STARTERS[type] ?? ["What happened here?", "Is this a timing lag or a real break?"];
}

/** The flattened text of a message — its `text` parts joined, for display and search. */
export function textOf(message: { parts: readonly { type: string }[] }): string {
  return (message.parts as { type: string; text?: string }[])
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

/** Seed useChat from the saved thread — attribution and citations ride as metadata. */
export function toUiMessages(messages: InvestigationMessage[]): InvestigationUIMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text", text: m.text }],
    metadata: {
      authorName: m.authorName,
      createdAt: m.createdAt,
      citations: m.citations,
      toolTrail: m.toolTrail,
      supersedesId: m.supersedesId,
      model: m.model,
    },
  }));
}

const VERB: Record<string, string> = {
  get_transaction: "reading transaction",
  get_raw: "reading raw record",
  get_run: "checking run",
  get_run_diff: "checking the run diff",
  get_sources: "checking sources",
};

/** The live-trace phrase for a tool call — "reading raw record 3f2a…". */
export function toolVerb(tool: string): string {
  return VERB[tool] ?? tool.replace(/_/g, " ");
}

const TOOL_KIND: Record<string, Citation["kind"]> = {
  get_transaction: "transaction",
  get_raw: "raw",
  get_run: "run",
  get_run_diff: "run",
};

interface ToolPartLike {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

function isToolPart(p: { type: string }): p is ToolPartLike {
  return p.type.startsWith("tool-");
}

function outputId(output: unknown): string | null {
  if (typeof output !== "object" || output === null) return null; // a miss returns a string
  const o = output as { id?: string; runId?: string };
  return o.id ?? o.runId ?? null;
}

export interface TraceCall {
  tool: string;
  ref: string | null;
  done: boolean;
}

/** The live provenance spine: every tool call Clara has made in this turn, in order. */
export function traceFromParts(parts: readonly { type: string }[]): TraceCall[] {
  return parts.filter(isToolPart).map((p) => ({
    tool: p.type.slice("tool-".length),
    ref: (p.input as { id?: string } | undefined)?.id ?? null,
    done: p.state === "output-available",
  }));
}

/**
 * The verified set for a live turn: the seeded case ids plus every id a tool
 * actually returned. This is the fabrication guard — an id Clara never retrieved
 * is never in the set, so the UI never links it.
 */
export function liveVerifiedIds(
  parts: readonly { type: string }[],
  seededIds: Iterable<string>,
): Set<string> {
  const set = new Set(seededIds);
  for (const p of parts.filter(isToolPart)) {
    const id = outputId(p.output);
    if (id !== null) set.add(id);
  }
  return set;
}

/** "Records consulted" for a just-streamed turn, derived from its tool outputs. */
export function consultedFromParts(parts: readonly { type: string }[]): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const p of parts.filter(isToolPart)) {
    const kind = TOOL_KIND[p.type.slice("tool-".length)];
    const id = outputId(p.output);
    if (kind === undefined || id === null || seen.has(id)) continue;
    seen.add(id);
    const o = p.output as { source?: string; sourceId?: string };
    const label = o.source && o.sourceId ? `${o.source} ${o.sourceId}` : id.slice(0, 8);
    out.push({ kind, id, label });
  }
  return out;
}
