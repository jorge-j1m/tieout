import { DoubleRule } from "@/components/primitives/DoubleRule";

/**
 * The demo's lent operator key, published right on the login page — kept, like
 * everything settled in bookkeeping, under the double rule. Renders only when
 * `DEMO_LOGIN_HINT` ("name:token") is set, so a private deployment never
 * advertises a key; the pair must exist in the API's `API_OPERATOR_TOKENS` or
 * the hint offers a key that doesn't turn. Half a credential is worse than
 * none: a malformed value renders nothing.
 */
export function LoginHint() {
  const hint = process.env.DEMO_LOGIN_HINT ?? "";
  const colon = hint.indexOf(":");
  const name = hint.slice(0, colon);
  const token = hint.slice(colon + 1);
  if (colon === -1 || name === "" || token === "") return null;

  return (
    <aside className="mt-8 w-full max-w-[360px] text-[13px] leading-relaxed text-muted">
      <p>
        No account? The demo lends one. Bookkeepers keep settled things under the double rule —
        that&rsquo;s where we keep the spare key:
      </p>
      <DoubleRule className="mt-3.5 w-14" />
      <p className="mt-2.5 font-mono text-[12.5px]">
        <span className="text-muted">name </span>
        <span className="text-ink">{name}</span>
        <span className="text-muted"> · token </span>
        <span className="text-ink">{token}</span>
      </p>
      <p className="mt-3 text-[11.5px] italic">
        Whatever you do lands on the append-only record, signed “{name}” — leave the books tidier
        than you found them.
      </p>
    </aside>
  );
}
