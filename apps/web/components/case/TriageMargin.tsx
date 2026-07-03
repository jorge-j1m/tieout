import type { TriageSuggestion } from "@tieout/contracts";

/**
 * The LLM triage note (D33), styled as a margin annotation — a pencil note on a
 * printed statement, unmistakably *not* part of the record. It suggests; it
 * never blocks and never edits. The public demo shows only precomputed ones.
 */
export function TriageMargin({ suggestion }: { suggestion: TriageSuggestion }) {
  return (
    <aside className="border-l-2 border-dashed border-hair pl-4 text-sm">
      <p className="label-caps mb-2 normal-case tracking-normal">
        Suggested by Claude · never blocks, never edits
      </p>
      <p className="font-mono text-xs text-muted">{suggestion.classification}</p>
      <p className="mt-2 text-ink">{suggestion.explanation}</p>
      <p className="mt-2 text-ink">
        <span className="text-muted">Next: </span>
        {suggestion.suggestedAction}
      </p>
      <p className="mt-3 text-xs text-muted">
        {suggestion.model} · {suggestion.promptVersion} · confidence {suggestion.confidence}
      </p>
    </aside>
  );
}
