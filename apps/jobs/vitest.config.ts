import { defineConfig } from "vitest/config";

// In postgres mode the suites share one `<name>_test` database — keep files sequential.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
