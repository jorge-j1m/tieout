import { createHash } from "node:crypto";

/**
 * Canonical JSON: deterministic serialization for content hashing (D8). Object keys
 * are sorted recursively; non-JSON values (bigint, function, NaN, ...) throw rather
 * than serialize ambiguously.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson: non-finite number ${value}`);
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
      return `{${entries.join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: cannot serialize ${typeof value}`);
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Content hash of a payload: equality means "same observation", inequality means "new version". */
export function contentHash(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

/**
 * Deterministic synthetic id for id-less source lines (D10): file identity + normalized
 * line content + occurrence index. The occurrence index preserves legitimate duplicates.
 */
export function syntheticSourceId(
  fileIdentity: string,
  lineContent: string,
  occurrenceIndex: number,
): string {
  if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0) {
    throw new TypeError(`syntheticSourceId: occurrenceIndex must be a non-negative integer`);
  }
  return `syn_${sha256Hex(`${fileIdentity}\n${lineContent}\n${occurrenceIndex}`).slice(0, 32)}`;
}
