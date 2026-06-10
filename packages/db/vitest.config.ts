import { defineConfig } from "vitest/config";

// In postgres mode the suites share one `<name>_test` database — test files must
// not interleave truncations (PGlite mode is per-file anyway, but one rule is simpler).
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
