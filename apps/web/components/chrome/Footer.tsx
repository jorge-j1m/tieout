import { Shell } from "@/components/primitives/Shell";

/** The one-line promise closes every page. It is the product's first sentence too. */
export function Footer() {
  return (
    <footer className="border-t border-hair">
      <Shell className="py-6">
        <p className="text-xs text-muted">Mercadia demo · synthetic data · resets nightly</p>
        <p className="mt-1.5 text-xs italic text-muted">
          Tieout observes and explains. It never moves money, never edits your books, and never
          guesses.
        </p>
      </Shell>
    </footer>
  );
}
