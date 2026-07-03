"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";

/** One jump target: a run, break, exception, or view, by name or id. */
export interface SearchItem {
  label: string;
  sub: string;
  href: Route;
}

/** Navigation is always reachable; data ids join the index when pages pass them in. */
const BASE_ITEMS: SearchItem[] = [
  { label: "Overview", sub: "the morning-coffee screen", href: "/" },
  { label: "Runs", sub: "all nightly runs", href: "/runs" },
  { label: "Breaks", sub: "the worklist", href: "/breaks" },
  { label: "Exceptions", sub: "open cases", href: "/exceptions" },
  { label: "Quarantine", sub: "a worklist, not a trash can", href: "/quarantine" },
];

/**
 * The ⌘K palette: jump to any run, break, exception, or transaction by id.
 * Client-only surface over server-provided items — it never fetches.
 */
export function CommandSearch({ items = [] }: { items?: SearchItem[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const all = [...items, ...BASE_ITEMS];
  const q = query.trim().toLowerCase();
  const filtered = q === "" ? all : all.filter((i) => `${i.label} ${i.sub}`.toLowerCase().includes(q));

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setQuery("");
        }}
        aria-label="Search (Command K)"
        className="cursor-pointer rounded-[2px] border border-hair bg-paper px-2.5 py-1.5 font-mono text-xs tracking-[0.02em] text-muted hover:border-ink hover:text-ink"
      >
        ⌘K
      </button>

      {open && (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/35 px-5 pt-[12vh]"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Jump to"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[560px] border border-hair bg-paper shadow-[0_12px_40px_rgba(22,19,14,0.18)]"
          >
            <div className="border-b border-hair px-[18px] py-3.5">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Jump to a view…"
                className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
              />
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-1.5">
              {filtered.map((item) => (
                <li key={`${item.href}-${item.label}`}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex flex-col gap-0.5 rounded-[2px] px-3 py-2.5 no-underline hover:bg-wash"
                  >
                    <span className="font-mono text-[13px] text-ink">{item.label}</span>
                    <span className="text-xs text-muted">{item.sub}</span>
                  </Link>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-2.5 text-xs text-muted">Nothing by that name.</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
