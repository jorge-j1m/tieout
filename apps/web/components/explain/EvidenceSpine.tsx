import type { Break, RawWithBatch, TransactionWithVersions } from "@tieout/contracts";
import { Money } from "@/components/primitives/Money";
import { Mono } from "@/components/primitives/Mono";
import { StateChip } from "@/components/primitives/StateChip";
import { UtcTime } from "@/components/primitives/UtcTime";
import { buildEvidenceChain } from "@/lib/explain/present";
import { shortId } from "@/lib/ids";
import { EvidenceHop } from "./EvidenceHop";
import { Facts, Identity } from "./Facts";
import { MatchingSteps } from "./MatchingSteps";
import { PayloadViewer } from "./PayloadViewer";
import { VariantPanel } from "./variants";
import { VersionChain } from "./VersionChain";

/**
 * The provenance spine: five numbered hops from the conclusion down to the raw
 * bytes and the batch that carried them — the product's reason to exist. Server
 * component; every value traces to a fetch, nothing is decorative.
 */
export function EvidenceSpine({
  brk,
  transaction,
  raw,
  run,
}: {
  brk: Break;
  transaction: TransactionWithVersions | null;
  raw: RawWithBatch | null;
  run: { id: string; asOf: string; rulesetVersion: string };
}) {
  const hops = buildEvidenceChain({ break: brk, transaction, raw });

  return (
    <ol className="list-none">
      {hops.map((hop, i) => {
        const index = i + 1;
        const last = index === hops.length;
        switch (hop.kind) {
          case "conclusion":
            return (
              <EvidenceHop key={hop.kind} index={index} title={hop.title}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <StateChip tone="break" label={hop.typeLabel} />
                  <span className="text-sm text-ink">{hop.gloss}</span>
                </div>
                <p className="mt-2 text-sm text-muted">
                  Concluded by {run.rulesetVersion} in run{" "}
                  <Mono className="text-ink">{shortId(run.id)}</Mono>, as of{" "}
                  <UtcTime iso={run.asOf} className="text-ink" />.
                </p>
              </EvidenceHop>
            );
          case "matching":
            return (
              <EvidenceHop key={hop.kind} index={index} title={hop.title}>
                <MatchingSteps steps={hop.steps} />
              </EvidenceHop>
            );
          case "transaction": {
            const t = transaction ?? hop.primary;
            return (
              <EvidenceHop key={hop.kind} index={index} title={hop.title}>
                <Facts
                  rows={[
                    {
                      label: "identity",
                      value: <Identity parts={[t.source, t.sourceAccount, t.sourceId]} />,
                    },
                    { label: "type", value: t.type },
                    {
                      label: "amount",
                      value: <Money minor={t.amountMinor} currency={t.currency} />,
                    },
                    { label: "occurred", value: <UtcTime iso={t.occurredAt} /> },
                    ...(transaction
                      ? [
                          { label: "observed", value: <UtcTime iso={transaction.observedAt} /> },
                          {
                            label: "version",
                            value: (
                              <span>
                                v{transaction.version}{" "}
                                <span className="text-matched">
                                  {transaction.isCurrent ? "· current" : ""}
                                </span>
                              </span>
                            ),
                          },
                          { label: "normalized by", value: <Mono>{transaction.normalizerVersion}</Mono> },
                        ]
                      : []),
                  ]}
                />
                {transaction && <VersionChain versions={transaction.versions} />}
                <div className="mt-4">
                  <VariantPanel brk={brk} />
                </div>
              </EvidenceHop>
            );
          }
          case "raw":
            return (
              <EvidenceHop key={hop.kind} index={index} title={hop.title} last={last}>
                {raw ? (
                  <PayloadViewer payload={raw.payload} contentHash={raw.contentHash} />
                ) : (
                  <p className="text-sm text-muted">The raw record is not available.</p>
                )}
              </EvidenceHop>
            );
          case "batch":
            return (
              <EvidenceHop key={hop.kind} index={index} title={hop.title} last={last}>
                {hop.batch ? (
                  <Facts
                    rows={[
                      { label: "source", value: hop.batch.source },
                      { label: "idempotency key", value: <Mono>{hop.batch.idempotencyKey}</Mono> },
                      { label: "landed", value: <UtcTime iso={hop.batch.observedAt} /> },
                      { label: "status", value: hop.batch.status },
                    ]}
                  />
                ) : (
                  <p className="text-sm text-muted">The ingestion batch is not available.</p>
                )}
              </EvidenceHop>
            );
        }
      })}
    </ol>
  );
}
