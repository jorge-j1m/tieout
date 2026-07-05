"use client";

import { Streamdown } from "streamdown";
import { CiteProvider } from "./citation-context";
import { RecordCite } from "./RecordCite";

/**
 * Clara's answer, rendered as it streams. Streamdown handles half-finished
 * markdown gracefully; every link routes through `RecordCite`, which is also the
 * safety boundary — only a verified `cite:` link becomes a real link, everything
 * else (an outside or `javascript:` href, an unverified id) degrades to plain
 * text. Images are dropped to their alt text. Prose is styled to the ledger
 * tokens via `.investigate-prose`.
 */

const CiteLink = (props: { href?: string; children?: React.ReactNode }) => (
  <RecordCite href={props.href}>{props.children}</RecordCite>
);

const AltText = (props: { alt?: string }) => <>{props.alt ?? ""}</>;

export function ClaraAnswer({
  text,
  verified,
  breakId,
  streaming,
}: {
  text: string;
  verified: Set<string>;
  breakId?: string;
  streaming: boolean;
}) {
  return (
    <CiteProvider value={{ verified, breakId }}>
      <div className="investigate-prose text-[14px] leading-relaxed text-ink">
        <Streamdown
          parseIncompleteMarkdown
          shikiTheme={["github-light", "github-light"]}
          components={{ a: CiteLink, img: AltText }}
        >
          {text}
        </Streamdown>
        {streaming && <span aria-hidden className="investigate-caret" />}
      </div>
    </CiteProvider>
  );
}
