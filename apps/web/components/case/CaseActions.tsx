"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { acknowledgeCase, resolveCase, type MutationState } from "@/app/case-actions";

type Modal = "acknowledge" | "resolve";

const DEMO_NOTE = "Read-only demo — enforced server-side, not just here.";
const STANDING = "Resolving never edits financial data. If the next run disagrees, this case reopens.";

const GHOST = "rounded-[2px] border border-ink bg-paper px-4 py-2.5 text-sm text-ink hover:bg-wash";
const SOLID = "rounded-[2px] border border-ink bg-ink px-4 py-2.5 text-sm text-paper hover:opacity-90";

/** The dialog's submit button — pending-aware, and blocked until a resolve reason exists. */
function Submit({ blocked, label }: { blocked: boolean; label: string }) {
  const { pending } = useFormStatus();
  const disabled = blocked || pending;
  return (
    <button
      type="submit"
      disabled={disabled}
      className="rounded-[2px] border border-ink bg-ink px-4 py-2 text-[13px] text-paper disabled:cursor-not-allowed disabled:border-hair disabled:bg-[#C9C2B2]"
    >
      {pending ? `${label}…` : label}
    </button>
  );
}

/** Acknowledge/resolve dialog: an optional note, or a required reason. */
function CaseDialog({
  kind,
  exceptionId,
  onClose,
}: {
  kind: Modal;
  exceptionId: string;
  onClose: () => void;
}) {
  const isResolve = kind === "resolve";
  const [state, action] = useActionState<MutationState, FormData>(
    isResolve ? resolveCase : acknowledgeCase,
    {},
  );
  const [text, setText] = useState("");

  // The action revalidates the page on success; close the dialog once it lands.
  useEffect(() => {
    if (state.ok === true) onClose();
  }, [state.ok, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(22,19,14,0.35)] p-5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isResolve ? "Resolve this case" : "Acknowledge this case"}
        className="w-full max-w-[440px] border border-hair bg-paper p-6"
      >
        <div className="text-base font-semibold text-ink">
          {isResolve ? "Resolve this case" : "Acknowledge this case"}
        </div>
        <p className="mt-2 mb-4 text-[13px] leading-relaxed text-muted">
          {isResolve
            ? "One reason, required. This never edits financial data."
            : "Optional note — lets the next person know you’ve seen it."}
        </p>
        <form action={action}>
          <input type="hidden" name="id" value={exceptionId} />
          <textarea
            name={isResolve ? "reason" : "note"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            placeholder={isResolve ? "e.g. Booked the fee, JE-441" : "Optional note…"}
            className="min-h-[88px] w-full resize-y border border-hair bg-paper p-2.5 text-[13.5px] text-ink outline-none focus:border-ink"
          />
          <p className="mt-3 text-[11.5px] italic leading-relaxed text-muted">{STANDING}</p>
          {state.error !== undefined && (
            <p role="alert" className="mt-2 text-[13px] text-break">
              {state.error}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[2px] border border-hair bg-transparent px-4 py-2 text-[13px] text-ink hover:bg-wash"
            >
              Cancel
            </button>
            <Submit blocked={isResolve && text.trim() === ""} label={isResolve ? "Resolve" : "Acknowledge"} />
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Operator actions on a case. For the demo persona the controls are visible but
 * inert, with the honest note that the real guard is the API — not this
 * `disabled` attribute. For an operator they open a dialog that posts through a
 * server action; the page revalidates itself when the append-only trail grows.
 */
export function CaseActions({
  exceptionId,
  canMutate,
}: {
  exceptionId: string | null;
  canMutate: boolean;
}) {
  const [modal, setModal] = useState<Modal | null>(null);
  const live = canMutate && exceptionId !== null;

  if (!live) {
    return (
      <div>
        <div className="flex flex-wrap gap-2.5" title={DEMO_NOTE}>
          <span className="cursor-not-allowed rounded-[2px] border border-hair px-4 py-2.5 text-sm text-muted">
            Acknowledge
          </span>
          <span className="cursor-not-allowed rounded-[2px] border border-hair px-4 py-2.5 text-sm text-muted">
            Resolve
          </span>
        </div>
        <p className="mt-2.5 text-xs italic text-muted">{STANDING}</p>
        {!canMutate && <p className="mt-1.5 text-[11.5px] text-muted">{DEMO_NOTE}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2.5">
        <button type="button" onClick={() => setModal("acknowledge")} className={GHOST}>
          Acknowledge
        </button>
        <button type="button" onClick={() => setModal("resolve")} className={SOLID}>
          Resolve
        </button>
      </div>
      <p className="mt-2.5 text-xs italic text-muted">{STANDING}</p>
      {modal !== null && (
        <CaseDialog kind={modal} exceptionId={exceptionId} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
