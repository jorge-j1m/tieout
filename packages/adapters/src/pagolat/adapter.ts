import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  CanonicalTxnType,
  LandedBatch,
  NormalizeResult,
  QuarantineError,
  RawForNormalize,
  SourceAdapter,
  TxnStatus,
} from "@tieout/contracts";
import { normalizedTxnSchema } from "@tieout/contracts";
import {
  MoneyParseError,
  parseDecimalToMinor,
  sha256Hex,
  syntheticSourceId,
} from "@tieout/core";
import { quarantine } from "../quarantine.js";

export const PAGOLAT_SOURCE = "pagolat";
export const PAGOLAT_NORMALIZER_VERSION = "pagolat-v1";

/**
 * PagoLat: the invented LatAm PSP that behaves like the worst real ones — daily
 * settlement files, semicolon-delimited, locale decimals (`1.234,56`), local
 * timestamps with a declared UTC offset, per-line commissions, **no line ids**,
 * and headers/footers carrying control totals that occasionally lie.
 *
 *   PAGOLAT;SETTLEMENT;v1;<merchant_account>;<date>;<utc_offset>
 *   HEADER;opening_balance;<amount>
 *   LINE;<local datetime>;<type>;<order_ref>;<gross>;<commission>;<net>;<description>
 *   …
 *   FOOTER;line_count;<n>;total_net;<amount>;closing_balance;<amount>
 *
 * Control totals are verified at LANDING (D13): line count, Σ line nets =
 * declared total, opening + total = closing. A file that fails them is
 * quarantined whole — landing half of a lying file manufactures false breaks.
 *
 * Lines have no ids: identity is the deterministic synthetic id (file identity +
 * line content + occurrence index, D10) — two legitimately identical sales stay
 * two records. Every line carries `groupRef` = the settlement unit; the ledger
 * books one entry per unit referencing the same key, and grouped matching
 * compares the nets (ruleset-v2).
 */

const FILE_SIGNATURE = "PAGOLAT;SETTLEMENT;v1";
const OFFSET_FORMAT = /^[+-]\d{2}:\d{2}$/;
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const CURRENCY = "MXN";

const PAGOLAT_TYPE_MAP: Readonly<Record<string, CanonicalTxnType>> = {
  sale: "payment",
  refund: "refund",
  fee: "fee",
  adjustment: "adjustment",
};

/** Settled by definition: a settlement file reports money PagoLat already moved. */
const PAGOLAT_STATUS: TxnStatus = "settled";

/** The settlement unit key both sides name: pagolat lines via groupRef, the ledger entry via reference. */
export function pagolatSettlementKey(account: string, date: string): string {
  return `PL-${account}-${date}`;
}

interface ParsedFile {
  account: string;
  date: string;
  offset: string;
  openingBalance: string;
  lines: string[];
  declaredCount: number;
  declaredTotalNet: string;
  closingBalance: string;
}

function parseFile(content: string, fileName: string): ParsedFile {
  const rows = content.split("\n").filter((line) => line.trim() !== "");
  const head = rows[0]?.split(";") ?? [];
  if (rows[0] === undefined || !rows[0].startsWith(FILE_SIGNATURE) || head.length !== 6) {
    throw new Error(`${fileName}: not a PagoLat v1 settlement file`);
  }
  const [, , , account, date, offset] = head as [string, string, string, string, string, string];
  if (!OFFSET_FORMAT.test(offset)) {
    throw new Error(`${fileName}: malformed UTC offset ${JSON.stringify(offset)}`);
  }
  const header = rows[1]?.split(";");
  if (header?.[0] !== "HEADER" || header[1] !== "opening_balance" || header.length !== 3) {
    throw new Error(`${fileName}: missing HEADER row`);
  }
  const footer = rows[rows.length - 1]?.split(";");
  if (
    footer?.[0] !== "FOOTER" ||
    footer[1] !== "line_count" ||
    footer[3] !== "total_net" ||
    footer[5] !== "closing_balance" ||
    footer.length !== 7
  ) {
    throw new Error(`${fileName}: missing FOOTER row`);
  }
  return {
    account,
    date,
    offset,
    openingBalance: header[2]!,
    lines: rows.slice(2, -1),
    declaredCount: Number(footer[2]),
    declaredTotalNet: footer[4]!,
    closingBalance: footer[6]!,
  };
}

/**
 * Verify the file's own arithmetic (D13). Returns structured errors — the
 * caller turns a non-empty list into a whole-batch quarantine.
 */
function verifyControlTotals(file: ParsedFile): QuarantineError[] {
  const errors: QuarantineError[] = [];
  if (file.lines.length !== file.declaredCount) {
    errors.push({
      path: "footer.line_count",
      message: `file declares ${file.declaredCount} lines but carries ${file.lines.length}`,
    });
  }
  let computed: bigint | undefined = 0n;
  for (const line of file.lines) {
    const net = line.split(";")[6];
    try {
      computed += parseDecimalToMinor(net ?? "", CURRENCY, "comma");
    } catch {
      computed = undefined; // line-level drift is normalize's job; totals can't be checked
      break;
    }
  }
  if (computed !== undefined) {
    try {
      const declared = parseDecimalToMinor(file.declaredTotalNet, CURRENCY, "comma");
      const opening = parseDecimalToMinor(file.openingBalance, CURRENCY, "comma");
      const closing = parseDecimalToMinor(file.closingBalance, CURRENCY, "comma");
      if (computed !== declared) {
        errors.push({
          path: "footer.total_net",
          message: `lines sum to ${computed} minor units but the file declares ${declared}`,
        });
      }
      if (opening + declared !== closing) {
        errors.push({
          path: "footer.closing_balance",
          message: `opening + total_net ≠ closing (${opening} + ${declared} ≠ ${closing})`,
        });
      }
    } catch (err) {
      errors.push({ path: "footer", message: (err as Error).message });
    }
  }
  return errors;
}

export function normalizePagolatLine(raw: RawForNormalize): NormalizeResult {
  const payload = raw.payload as { line?: unknown; offset?: unknown; settlementKey?: unknown };
  if (
    typeof payload?.line !== "string" ||
    typeof payload.offset !== "string" ||
    typeof payload.settlementKey !== "string"
  ) {
    return quarantine([{ path: "payload", message: "not a landed PagoLat line" }]);
  }
  const fields = payload.line.split(";");
  if (fields[0] !== "LINE" || fields.length !== 8) {
    return quarantine([
      { path: "line", message: `expected 8 LINE fields, got ${fields.length}` },
    ]);
  }
  const [, localTime, rawType, orderRef, gross, commission, net, description] = fields as [
    string, string, string, string, string, string, string, string,
  ];

  const errors: QuarantineError[] = [];
  const type = PAGOLAT_TYPE_MAP[rawType];
  if (type === undefined) {
    errors.push({ path: "type", message: `unmapped pagolat type: ${rawType}` });
  }
  if (!LOCAL_DATETIME.test(localTime) || !OFFSET_FORMAT.test(payload.offset)) {
    errors.push({ path: "datetime", message: `malformed local datetime: ${JSON.stringify(localTime)}` });
  }
  let amountMinor: bigint | undefined;
  let netMinor: bigint | undefined;
  try {
    amountMinor = parseDecimalToMinor(gross, CURRENCY, "comma");
    netMinor = parseDecimalToMinor(net, CURRENCY, "comma");
    const commissionMinor = parseDecimalToMinor(commission, CURRENCY, "comma");
    if (amountMinor - commissionMinor !== netMinor) {
      errors.push({
        path: "net",
        message: `gross − commission ≠ net (${amountMinor} − ${commissionMinor} ≠ ${netMinor})`,
      });
    }
  } catch (err) {
    if (!(err instanceof MoneyParseError)) throw err;
    errors.push({ path: "amount", message: err.message });
  }
  if (errors.length > 0 || amountMinor === undefined || netMinor === undefined) {
    return quarantine(errors);
  }

  // Local time + the file's declared offset, converted exactly once (Rule 9).
  const occurredAt = new Date(`${localTime.replace(" ", "T")}${payload.offset}`);

  return {
    ok: true,
    txn: normalizedTxnSchema.parse({
      source: raw.source,
      sourceAccount: raw.sourceAccount,
      sourceId: raw.sourceId,
      sourceType: rawType,
      type,
      amountMinor,
      netMinor,
      currency: CURRENCY,
      occurredAt,
      valueDate: payload.settlementKey.slice(-10),
      account: raw.sourceAccount,
      reference: orderRef === "" ? null : orderRef,
      groupRef: payload.settlementKey,
      status: PAGOLAT_STATUS,
      metadata: { description, commission },
    }),
  };
}

export interface PagolatAdapterConfig {
  /** Day-file paths — each file is one complete, re-deliverable settlement unit. */
  files: string[];
  connection?: string;
}

export function createPagolatAdapter(config: PagolatAdapterConfig): SourceAdapter {
  return {
    source: PAGOLAT_SOURCE,
    normalizerVersion: PAGOLAT_NORMALIZER_VERSION,

    async land(ctx) {
      const batches: LandedBatch[] = [];
      for (const filePath of config.files) {
        const fileName = path.basename(filePath);
        const content = await readFile(filePath, "utf8");
        const fileHash = sha256Hex(content);
        const archiveUrl = ctx.archive
          ? await ctx.archive(`pagolat/${fileName}/${fileHash}`, content)
          : undefined;

        const file = parseFile(content, fileName);
        const settlementKey = pagolatSettlementKey(file.account, file.date);
        const integrity = verifyControlTotals(file);

        // Occurrence index per identical line content (D10): legitimate duplicate
        // lines stay distinct records instead of collapsing into one.
        const occurrence = new Map<string, number>();
        batches.push({
          source: PAGOLAT_SOURCE,
          connection: config.connection ?? "sftp-drop",
          kind: "file",
          externalRef: fileName,
          idempotencyKey: `pagolat:${file.account}:${file.date}:${fileHash}`,
          completeUnit: { key: `pagolat:${file.account}:${file.date}` },
          controlTotals: {
            lineCount: file.declaredCount,
            totalNet: file.declaredTotalNet,
            openingBalance: file.openingBalance,
            closingBalance: file.closingBalance,
          },
          ...(integrity.length > 0 ? { integrityFailure: integrity } : {}),
          ...(archiveUrl === undefined ? {} : { archiveUrl }),
          records: file.lines.map((line) => {
            const seen = occurrence.get(line) ?? 0;
            occurrence.set(line, seen + 1);
            return {
              sourceAccount: file.account,
              sourceId: syntheticSourceId(fileHash, line, seen),
              payload: { line, offset: file.offset, settlementKey },
            };
          }),
        });
      }
      return batches;
    },

    normalize: normalizePagolatLine,
  };
}
