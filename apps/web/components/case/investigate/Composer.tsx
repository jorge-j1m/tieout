"use client";

/**
 * The composer. A ruled input in the ledger tones: Enter sends, Shift-Enter adds
 * a line; while a turn streams it offers Stop. For the demo persona (or an off /
 * over-budget deployment) it is inert with an honest note — the real guard is the
 * server (a write is rejected there), never this `disabled` attribute.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  canSend,
  editing,
  note,
  suggestions,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  canSend: boolean;
  editing: boolean;
  note: string | null;
  suggestions: string[];
}) {
  const submit = () => {
    const text = value.trim();
    if (text !== "" && canSend && !streaming) onSubmit(text);
  };

  return (
    <div className="mt-6">
      {suggestions.length > 0 && canSend && (
        <div className="mb-3 flex flex-wrap gap-2">
          {suggestions.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => canSend && onSubmit(prompt)}
              className="rounded-[2px] border border-hair bg-paper px-3 py-1.5 text-[12.5px] text-ink hover:bg-wash"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 border border-hair bg-paper focus-within:border-ink">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={!canSend}
          rows={2}
          maxLength={4000}
          placeholder={canSend ? (editing ? "Edit your question and re-ask…" : "Ask about this break…") : "Ask about this break…"}
          className="min-h-[52px] flex-1 resize-y bg-transparent px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:text-muted"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="m-1.5 shrink-0 rounded-[2px] border border-ink px-3 py-2 font-mono text-[12px] text-ink hover:bg-wash"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend || value.trim() === ""}
            className="m-1.5 shrink-0 rounded-[2px] border border-ink bg-ink px-3.5 py-2 font-mono text-[12px] text-paper hover:opacity-90 disabled:cursor-not-allowed disabled:border-hair disabled:bg-[#C9C2B2]"
          >
            {editing ? "Re-ask" : "Ask"}
          </button>
        )}
      </div>

      {note !== null && <p className="mt-2 text-[12px] italic leading-relaxed text-muted">{note}</p>}
    </div>
  );
}
