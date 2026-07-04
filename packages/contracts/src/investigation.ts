import { z } from "zod";

/**
 * Investigate with Claude (D38): a live, streamed, collaborative conversation on
 * an exception case. One shared thread per case; every operator sees every turn,
 * and every turn is attributed. Clara (the assistant) cites the record and
 * suggests — she never resolves, and matching stays deterministic (D33 holds).
 *
 * The store is append-only, the same invariant the financial rows obey (D8/D30):
 * a message row is written once, edits/retries write a new version that
 * supersedes, and a delete tombstones (an event, never a row removal). The live
 * thread is derived from the append-only log, never mutated in place.
 */

/** Bump when the system prompt changes; recorded on every assistant turn. */
export const INVESTIGATION_PROMPT_VERSION = "investigate-v1";

export const INVESTIGATION_MESSAGE_ROLES = ["user", "assistant"] as const;
export type InvestigationMessageRole = (typeof INVESTIGATION_MESSAGE_ROLES)[number];

/**
 * The append-only history of a message. `created` marks a turn's birth;
 * `edited`/`retried` mark a turn that was replaced by a newer version;
 * `deleted` tombstones a turn (gone from the live thread and from Clara's
 * future context, retained for audit).
 */
export const INVESTIGATION_EVENT_KINDS = ["created", "edited", "retried", "deleted"] as const;
export type InvestigationEventKind = (typeof INVESTIGATION_EVENT_KINDS)[number];

/** The record kinds Clara can cite — each resolves to an in-app deep link. */
export const CITATION_KINDS = ["transaction", "raw", "run", "break", "exception"] as const;
export type CitationKind = (typeof CITATION_KINDS)[number];

/**
 * A citation is a receipt: Clara may only cite a record she verifiably retrieved
 * through a tool. The web renders the href from `{kind,id}` via route helpers —
 * a URL never comes from model text — and links only ids in the verified set.
 */
export const citationSchema = z.object({
  kind: z.enum(CITATION_KINDS),
  id: z.uuid(),
  label: z.string().max(120),
});
export type Citation = z.infer<typeof citationSchema>;

/** One line of the "records consulted" trail: a tool Clara called and what it opened. */
export const toolTrailEntrySchema = z.object({
  tool: z.string().max(60),
  ref: z.string().max(160).nullable(),
});
export type ToolTrailEntry = z.infer<typeof toolTrailEntrySchema>;

/** An operator's question is short — the public write path stays bounded (the demo lends its key). */
export const INVESTIGATION_QUESTION_MAX = 4000;
/** A stored turn's flattened text (a full streamed answer fits comfortably). */
export const INVESTIGATION_TEXT_MAX = 24000;
