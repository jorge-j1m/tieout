"use server";

import { revalidatePath } from "next/cache";
import type { InvestigationMessage } from "@tieout/contracts";
import { deleteInvestigationMessage, getInvestigation } from "@/lib/api/endpoints";
import { getSessionToken } from "@/lib/session";

/**
 * The non-streaming halves of the investigation (D38). Delete forwards the
 * operator token to the API, which is the authority — it re-checks the token and
 * appends a `deleted` event; the row is never removed. `fetchThread` re-reads the
 * saved conversation so the live client can reconcile ids and pull other
 * operators' turns after each exchange. Reads are open; the delete is guarded.
 */

export interface DeleteTurnState {
  ok?: boolean;
  error?: string;
}

/** Tombstone a turn — gone from the live thread and from Clara's future context, kept for audit. */
export async function deleteInvestigationTurn(input: {
  messageId: string;
  exceptionId: string;
  note?: string;
}): Promise<DeleteTurnState> {
  const token = await getSessionToken();
  if (token === undefined) return { error: "Your operator session has ended. Sign in again." };
  const result = await deleteInvestigationMessage(input.messageId, token, input.note);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/exceptions/${input.exceptionId}`);
  return { ok: true };
}

/** The current live thread — the authoritative turns, ordered, superseded and deleted dropped. */
export async function fetchInvestigationThread(
  exceptionId: string,
): Promise<InvestigationMessage[]> {
  const thread = await getInvestigation(exceptionId);
  return thread?.messages ?? [];
}
