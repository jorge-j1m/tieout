/**
 * Vitest stand-in for the `server-only` guard package. The real module throws
 * when bundled into client code; under jsdom tests we only need it inert.
 */
export {};
