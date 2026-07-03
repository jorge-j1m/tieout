import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import { config as base } from "@tieout/eslint-config/base";

// eslint-config-next 15.x ships eslintrc-style configs; FlatCompat is the
// documented bridge until its flat exports arrive with Next 16.
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = [
  ...base,
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "out/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
