"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/api/endpoints";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Server actions — the web's only write path. Auth here (login/logout) manages
 * the session cookie; the exception mutations live in `case-actions.ts`. Every
 * one runs on the server, so the operator token never reaches client JS and the
 * API re-checks it regardless.
 */

/** Whether to mark the session cookie `secure` — on in production unless overridden. */
function cookieSecure(): boolean {
  const flag = process.env.SESSION_COOKIE_SECURE;
  return flag !== undefined ? flag === "true" : process.env.NODE_ENV === "production";
}

export interface LoginState {
  error?: string;
}

/**
 * Exchange an operator token for a session. The token is the credential; the
 * name is a courtesy check so a mistyped pairing fails clearly instead of
 * logging you in as someone else. Validation goes through the API's `/me`, so
 * the web never decides who is an operator — it only relays the answer.
 */
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const name = String(formData.get("name") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  if (token === "") return { error: "Enter your operator token." };

  const me = await getMe(token).catch(() => null);
  if (me === null || me.operator === null) {
    return { error: "That token isn’t a valid operator token." };
  }
  if (name !== "" && name !== me.operator) {
    return { error: `That token belongs to ${me.operator}, not “${name}”.` };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // a working shift
  });
  redirect("/");
}

/** Drop the session and return to the demo persona. */
export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/");
}
