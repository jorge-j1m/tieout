import type { ZodError } from "zod";
import type { NormalizeResult, QuarantineError } from "@tieout/contracts";

export function quarantineFromZod(error: ZodError): NormalizeResult {
  return {
    ok: false,
    errors: error.issues.map(
      (issue): QuarantineError => ({
        path: issue.path.map(String).join(".") || "(root)",
        message: issue.message,
      }),
    ),
  };
}

export function quarantine(errors: QuarantineError[]): NormalizeResult {
  return { ok: false, errors };
}
