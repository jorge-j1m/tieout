"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/cx";

/**
 * Copies a value (a hash, a fingerprint, an id) and says so briefly. Text-only
 * feedback — no icon fonts, no emoji (brief: never).
 */
export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${value}`}
      className={cx(
        "cursor-pointer text-xs text-muted underline decoration-hair underline-offset-2 hover:text-ink",
        className,
      )}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}
