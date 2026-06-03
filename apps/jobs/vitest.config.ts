import { defineConfig } from "vitest/config";

// One shared database — keep test files sequential.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
