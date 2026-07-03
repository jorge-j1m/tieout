"use server";

import { revalidatePath } from "next/cache";
import { postJson } from "@/lib/api/client";
import { getSessionToken } from "@/lib/session";

/**
 * The exception mutations — acknowledge and resolve. Both forward the operator's
 * session token to the API, which is the real authority: it re-checks the token,
 * enforces the legal transition, and appends an immutable event. The web never
 * writes financial data, and never claims an operator the API wouldn't.
 */

export interface MutationState {
  ok?: boolean;
  error?: string;
}

/** Run a guarded mutation, then revalidate every view that shows the case. */
async function mutate(
  id: string,
  action: string,
  body: unknown,
  fromPath: string,
): Promise<MutationState> {
  const token = await getSessionToken();
  if (token === undefined) return { error: "Your operator session has ended. Sign in again." };

  const result = await postJson(`/exceptions/${id}/${action}`, body, token);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/exceptions/${id}`);
  revalidatePath("/exceptions");
  // The dialog also lives on the break-explain page's case rail — refresh
  // whichever page hosted it, or its timeline goes stale until a manual reload.
  if (fromPath.startsWith("/") && !fromPath.startsWith("/exceptions")) revalidatePath(fromPath);
  return { ok: true };
}

/** Acknowledge a case: an optional note, "I've seen this and I'm on it." */
export async function acknowledgeCase(_prev: MutationState, formData: FormData): Promise<MutationState> {
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const fromPath = String(formData.get("path") ?? "");
  return mutate(id, "acknowledge", { note: note === "" ? undefined : note }, fromPath);
}

/** Resolve a case: a required reason. This never edits the books — if the next run disagrees, it reopens. */
export async function resolveCase(_prev: MutationState, formData: FormData): Promise<MutationState> {
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const fromPath = String(formData.get("path") ?? "");
  if (reason === "") return { error: "A reason is required to resolve a case." };
  return mutate(id, "resolve", { reason }, fromPath);
}
