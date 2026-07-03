"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "@/app/actions";

const FIELD =
  "rounded-[2px] border border-hair bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-ink";
const LABEL = "flex flex-col gap-1.5 text-[11px] uppercase tracking-[0.05em] text-muted";

/** The submit button, dimmed and relabelled while the action is in flight. */
function SignIn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-[2px] border border-ink bg-ink py-2.5 text-sm text-paper disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

/**
 * Operator sign-in. The form posts to the `login` server action, which
 * validates the token through the API and sets the session cookie — this
 * component never sees the cookie, and a bad token comes back as a field error.
 */
export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="w-full max-w-[360px] border border-hair p-8">
      <div className="label-caps">Operator login</div>
      <p className="mt-1.5 mb-6 text-[13px] leading-relaxed text-muted">
        For the people who work exceptions. The demo needs no account.
      </p>

      <label className={LABEL}>
        Name
        <input name="name" placeholder="ana" autoComplete="username" className={FIELD} />
      </label>
      <label className={`${LABEL} mt-4`}>
        Token
        <input
          name="token"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          className={`${FIELD} font-mono`}
        />
      </label>

      {state.error !== undefined && (
        <p role="alert" className="mt-4 text-[13px] text-break">
          {state.error}
        </p>
      )}

      <div className="mt-6">
        <SignIn />
      </div>

      <Link
        href="/"
        className="mt-5 block text-center text-[13px] text-muted no-underline hover:text-ink"
      >
        ← continue as demo viewer
      </Link>
    </form>
  );
}
