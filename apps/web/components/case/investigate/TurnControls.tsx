"use client";

import { useState } from "react";

/**
 * Operator controls on the latest turn (D38), revealed on hover. The copy is
 * audit-honest: delete does not erase — it tombstones. Retry regenerates the
 * answer; edit re-asks the question. All three re-enter the same guarded paths;
 * the demo persona never sees them.
 */
const BTN = "text-[11.5px] text-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-40";

export function TurnControls({
  onRetry,
  onEdit,
  onDelete,
  busy,
}: {
  onRetry?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  busy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
        <span className="text-muted">
          Remove from the thread and Clara’s context? It stays in the record for audit — nothing is
          erased.
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            onDelete?.();
            setConfirming(false);
          }}
          className="text-break underline-offset-2 hover:underline disabled:opacity-40"
        >
          Remove
        </button>
        <button type="button" onClick={() => setConfirming(false)} className={BTN}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-3 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      {onRetry !== undefined && (
        <button type="button" disabled={busy} onClick={onRetry} className={BTN} title="Ask Clara again">
          Retry
        </button>
      )}
      {onEdit !== undefined && (
        <button type="button" disabled={busy} onClick={onEdit} className={BTN} title="Edit and re-ask">
          Edit
        </button>
      )}
      {onDelete !== undefined && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(true)}
          className={BTN}
          title="Removes it from the thread and Clara’s context; kept for audit"
        >
          Delete
        </button>
      )}
    </div>
  );
}
