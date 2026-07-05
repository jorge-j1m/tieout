"use client";

import { createContext, useContext } from "react";

/**
 * Per-message citation scope: which record ids Clara verifiably consulted in this
 * turn, and the case's break (so a transaction/raw mark can link into the
 * evidence chain). Provided around each answer so `RecordCite` links only what
 * this turn actually retrieved — the same set the server persisted.
 */
export interface CiteScope {
  verified: Set<string>;
  breakId?: string;
}

const CiteContext = createContext<CiteScope>({ verified: new Set() });

export const CiteProvider = CiteContext.Provider;
export const useCiteScope = (): CiteScope => useContext(CiteContext);
