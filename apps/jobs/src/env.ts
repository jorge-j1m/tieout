import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// Root .env; real environment variables always win (dotenv never overrides).
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
