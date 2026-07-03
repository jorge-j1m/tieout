import type { MatchingStep } from "@/lib/explain/present";
import { cx } from "@/lib/cx";

/**
 * "What matching tried": each pass that held or broke, in order. The verdict is
 * both colored and labeled — color is never the only signal.
 */
export function MatchingSteps({ steps }: { steps: MatchingStep[] }) {
  return (
    <ol className="border-t border-hair">
      {steps.map((step, i) => (
        <li
          key={i}
          className="flex flex-col gap-1 border-b border-hair py-3 sm:flex-row sm:items-baseline sm:gap-4"
        >
          <span className="label-caps shrink-0 sm:w-44">{step.label}</span>
          <span className="flex-1 text-sm text-ink">{step.detail}</span>
          <span
            className={cx(
              "shrink-0 text-xs font-semibold uppercase tracking-[0.06em]",
              step.pass ? "text-matched" : "text-break",
            )}
          >
            {step.pass ? "passed" : "broke here"}
          </span>
        </li>
      ))}
    </ol>
  );
}
