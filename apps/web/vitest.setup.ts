import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// Unmount React trees between tests so queries never see a previous render's DOM.
afterEach(cleanup);
