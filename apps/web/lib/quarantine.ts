import type { QuarantineRow } from "@tieout/contracts";

/**
 * Reading a quarantined record for display. The row's `errors` and `payload` are
 * jsonb (`unknown` at the boundary), so every field is checked, never trusted —
 * the same "quarantine, don't guess" discipline the engine applies to input.
 */

export interface QuarantineReason {
  path: string;
  message: string;
}

/** The structured reasons a record was held — the engine's precise statements. */
export function quarantineReasons(errors: unknown): QuarantineReason[] {
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((e): QuarantineReason[] => {
    if (e !== null && typeof e === "object" && "message" in e && typeof e.message === "string") {
      const path = "path" in e && typeof e.path === "string" ? e.path : "";
      return [{ path, message: e.message }];
    }
    return [];
  });
}

/**
 * A settlement file's declared footer, when the held payload carries one. These
 * are the file's own claims — shown verbatim (locale decimals and all), because
 * the contradiction is exactly that they don't match the lines.
 */
export interface DeclaredFooter {
  lineCount: number | null;
  totalNet: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
}

/** Extract the declared footer from a batch payload, or null for a non-footer payload. */
export function declaredFooter(payload: unknown): DeclaredFooter | null {
  if (payload === null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const footer: DeclaredFooter = {
    lineCount: typeof p.lineCount === "number" ? p.lineCount : null,
    totalNet: str(p.totalNet),
    openingBalance: str(p.openingBalance),
    closingBalance: str(p.closingBalance),
  };
  // A line-level payload has none of these; only a file footer does.
  return footer.lineCount !== null || footer.totalNet !== null ? footer : null;
}

/** Whether the whole batch was held (vs. a single line dropped in normalization). */
export function isWholeBatch(row: Pick<QuarantineRow, "stage">): boolean {
  return row.stage === "batch";
}

/** A friendly identity for a held record: the file name, else the source line id. */
export function quarantineTitle(row: Pick<QuarantineRow, "batchRef" | "sourceId" | "source">): string {
  return row.batchRef ?? row.sourceId ?? row.source;
}
