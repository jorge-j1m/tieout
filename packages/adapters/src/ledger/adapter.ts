import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  CanonicalTxnType,
  NormalizeResult,
  QuarantineError,
  RawForNormalize,
  SourceAdapter,
  TxnStatus,
} from "@tieout/contracts";
import { LEDGER_SOURCE, normalizedTxnSchema } from "@tieout/contracts";
import {
  canonicalJson,
  contentHash,
  isKnownCurrency,
  parseDecimalToMinor,
  syntheticSourceId,
} from "@tieout/core";
import { quarantine, quarantineFromZod } from "../quarantine.js";

// The id itself lives in contracts (the matching model partitions on it);
// re-exported here so adapter consumers keep their one import site.
export { LEDGER_SOURCE };
export const LEDGER_NORMALIZER_VERSION = "ledger-v1";

/**
 * Mercadia's internal ledger export. The ledger promises UTC timestamps and
 * dot-decimal amounts; anything that deviates is drift and quarantines.
 */
const ledgerEntrySchema = z.object({
  entryId: z.string().min(1),
  account: z.string().min(1),
  amount: z.string(),
  currency: z.string(),
  bookedAt: z.iso.datetime(),
  valueDate: z.iso.date(),
  type: z.string(),
  status: z.string(),
  reference: z.string().min(1).nullable(),
  description: z.string(),
});

/** Data-driven type/status maps (D15) — unmapped values quarantine, never default. */
const LEDGER_TYPE_MAP: Readonly<Record<string, CanonicalTxnType>> = {
  payment: "payment",
  refund: "refund",
  fee: "fee",
  payout: "payout",
  transfer: "transfer",
  adjustment: "adjustment",
};

const LEDGER_STATUS_MAP: Readonly<Record<string, TxnStatus>> = {
  posted: "settled",
  pending: "pending",
  void: "reversed",
};

export function normalizeLedgerEntry(raw: RawForNormalize): NormalizeResult {
  const parsed = ledgerEntrySchema.safeParse(raw.payload);
  if (!parsed.success) return quarantineFromZod(parsed.error);
  const entry = parsed.data;

  const errors: QuarantineError[] = [];
  const type = LEDGER_TYPE_MAP[entry.type];
  if (type === undefined) {
    errors.push({ path: "type", message: `unmapped ledger type: ${entry.type}` });
  }
  const status = LEDGER_STATUS_MAP[entry.status];
  if (status === undefined) {
    errors.push({ path: "status", message: `unmapped ledger status: ${entry.status}` });
  }
  let amountMinor: bigint | undefined;
  if (!isKnownCurrency(entry.currency)) {
    errors.push({ path: "currency", message: `unknown currency: ${entry.currency}` });
  } else {
    try {
      amountMinor = parseDecimalToMinor(entry.amount, entry.currency, "dot");
    } catch (err) {
      errors.push({ path: "amount", message: (err as Error).message });
    }
  }
  if (errors.length > 0 || amountMinor === undefined) return quarantine(errors);

  return {
    ok: true,
    txn: normalizedTxnSchema.parse({
      source: raw.source,
      sourceAccount: raw.sourceAccount,
      sourceId: raw.sourceId,
      sourceType: entry.type,
      type,
      amountMinor,
      // The ledger has no source-side fee concept: net is the amount.
      netMinor: amountMinor,
      currency: entry.currency,
      occurredAt: new Date(entry.bookedAt),
      valueDate: entry.valueDate,
      account: entry.account,
      reference: entry.reference,
      groupRef: null,
      status,
      metadata: { description: entry.description },
    }),
  };
}

export interface LedgerAdapterConfig {
  /** JSON array of ledger entries — the seeded internal system of record. */
  dataFile: string;
}

export function createLedgerAdapter(config: LedgerAdapterConfig): SourceAdapter {
  return {
    source: LEDGER_SOURCE,
    normalizerVersion: LEDGER_NORMALIZER_VERSION,

    // Lands the whole file as one unit. The idempotency key is the content hash
    // (a re-issued file is a new landing); the complete-unit key is the file's
    // NAME, stable across restatements, so identities that vanish from a
    // re-issued file get tombstone versions (D8).
    async land(_ctx) {
      const entries: unknown = JSON.parse(await readFile(config.dataFile, "utf8"));
      if (!Array.isArray(entries)) {
        throw new Error(`${config.dataFile}: expected a JSON array of ledger entries`);
      }
      const fileHash = contentHash(entries);
      return [
        {
          source: LEDGER_SOURCE,
          connection: "seed",
          kind: "file",
          externalRef: path.basename(config.dataFile),
          idempotencyKey: `ledger:file:${fileHash}`,
          completeUnit: { key: `ledger:${path.basename(config.dataFile)}` },
          controlTotals: { entryCount: entries.length },
          records: entries.map((e: unknown, index) => {
            const candidate = (e as { entryId?: unknown; account?: unknown }) ?? {};
            return {
              // Identity needs an account+id at landing; validation happens at normalize.
              sourceAccount:
                typeof candidate.account === "string" && candidate.account !== ""
                  ? candidate.account
                  : "unknown",
              sourceId:
                typeof candidate.entryId === "string" && candidate.entryId !== ""
                  ? candidate.entryId
                  : syntheticSourceId(fileHash, canonicalJson(e), index),
              payload: e,
            };
          }),
        },
      ];
    },

    normalize: normalizeLedgerEntry,
  };
}
