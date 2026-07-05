import { CITATION_KINDS, type CitationKind } from "@tieout/contracts";

/**
 * Clara cites records as markdown links with a custom target: `[label](cite:KIND:UUID)`.
 * Standard markdown (no raw HTML), so Streamdown leaves it intact and the `a`
 * component override (`RecordCite`) turns a *verified* one into a real in-app
 * link — and, being the only thing that ever produces a link, is also the safety
 * boundary: an unverified id or an outside href degrades to plain text. Pure and
 * unit-tested, so the fabrication guard can't drift.
 */

export interface CiteRef {
  kind: CitationKind;
  id: string;
}

/** Parse a `cite:KIND:UUID` href; null if it isn't one or names an unknown kind. */
export function parseCiteHref(href: string | undefined): CiteRef | null {
  if (href === undefined || !href.startsWith("cite:")) return null;
  const rest = href.slice("cite:".length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  const kind = rest.slice(0, sep);
  const id = rest.slice(sep + 1);
  if (id === "" || !CITATION_KINDS.includes(kind as CitationKind)) return null;
  return { kind: kind as CitationKind, id };
}
