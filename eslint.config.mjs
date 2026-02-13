// eslint.config.mjs
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  // 1) Ignore generated and vendor content
  {
    ignores: [
      "dist/**",
      "build/**",
      "coverage/**",
      ".next/**",
      "out/**",
      ".rollup.cache/**",
      "node_modules/**",
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "jest.worker-setup.ts",
    ],
  },

  // 2) Base JS recommended rules
  js.configs.recommended,

  // 3) TypeScript recommended + type-aware configs
  //    (requires parserOptions.project below)
  ...tseslint.configs.recommendedTypeChecked,

  // 4) Language options for TS/TSX (type-aware; include matches tsconfig)
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // Make sure this path matches your repo
        project: ["./tsconfig.eslint.json"],
        //tsconfigRootDir: new URL(".", import.meta.url),
        tsconfigRootDir: process.cwd(),
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      // Add any TypeScript-specific rule adjustments here
      // Examples:
      // '@typescript-eslint/explicit-function-return-type': 'off',
      // '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // 5) React + Hooks
  {
    files: ["**/*.jsx", "**/*.tsx"],
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // React recommended rules (flat-config aware)
      ...(react.configs?.recommended?.rules ?? {}),
      // For the modern JSX runtime (no React import needed)
      ...(react.configs?.["jsx-runtime"]?.rules ?? {}),

      // React Hooks recommended
      ...(reactHooks.configs?.recommended?.rules ?? {}),
    },
  },

  // 6) Globals for browser and node (use both if you have isomorphic code)
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
  },

  // 7) Test files: relax strict rules for Jest matchers (expect.objectContaining etc. use any)
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
];
