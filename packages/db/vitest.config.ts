import { defineConfig } from "vitest/config";

// One shared database — test files must not interleave truncations.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
