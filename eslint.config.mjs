// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import globals from "globals";

export default [
  // 1) Core ESLint recommended rules
  ...(Array.isArray(eslint.configs.recommended) ? eslint.configs.recommended : [eslint.configs.recommended]),

  // 2) TypeScript support + recommended rules
  ...(Array.isArray(tseslint.configs.recommended) ? tseslint.configs.recommended : [tseslint.configs.recommended]),

  // 3) React recommended rules (flat export)
  ...(function () {
    const c = react.configs.flat?.recommended ?? {
      plugins: { react },
      rules: react.configs.recommended.rules,
      settings: { react: { version: "detect" } },
    };
    return Array.isArray(c) ? c : [c];
  })(),

  // 4) React Hooks recommended rules (flat export)
  ...(Array.isArray(reactHooks.configs.flat.recommended) ? reactHooks.configs.flat.recommended : [reactHooks.configs.flat.recommended]),

  // 5) Project-wide language options & globals
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: Object.fromEntries(
        Object.entries({
          ...globals.browser,
          ...globals.node,
          JSX: "readonly",
        }).map(([k, v]) => [k.trim(), v])
      ),
    },
    settings: {
      // Keep React version autodetect as you had before
      react: { version: "detect" },
    },
  },

  // 6) TypeScript file-specific parser settings + your TS rule customizations
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        // If you later want "typed" rules, provide a tsconfig and enable the type-checked configs.
        // project: true,
      },
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // 7) Optional: keep your “no-prototype-builtins”: "off"
  {
    rules: {
      "no-prototype-builtins": "off",
    },
  },

  // 8) Prettier compatibility – turn off rules that conflict with Prettier.
  ...(Array.isArray(eslintConfigPrettier) ? eslintConfigPrettier : [eslintConfigPrettier]),

  // 9) Overrides for module-level queue pattern and stable callback pattern
  {
    files: ["src/shared/hooks/useApiWorker.ts", "src/shared/hooks/useCustomCallback.ts"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
    },
  },
];
