import resolve from "@rollup/plugin-node-resolve";
import esbuild from "rollup-plugin-esbuild";
import replace from "@rollup/plugin-replace";
import { dts } from "rollup-plugin-dts";
import babel from "@rollup/plugin-babel";

const jsConfig = {
  input: {
    vanilla: "src/shared/output/vanilla.ts",
    react: "src/shared/output/react.ts",
    "api.worker": "src/shared/workers/api/api.worker.ts",
  },
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: (chunkInfo) =>
      chunkInfo.name === "api.worker"
        ? "workers/api/api.worker.js"
        : "shared/output/[name].js",
    sourcemap: true,
  },
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        '"use client";': "",
      },
    }),
    babel({
      include: ["**/hooks/useApiWorker.ts"],
      plugins: [
        "@babel/plugin-syntax-typescript",
        ["babel-plugin-react-compiler", {}],
      ],
      extensions: [".ts", ".tsx"],
      babelHelpers: "bundled",
    }),
    esbuild({
      include: /\.[jt]sx?$/,
      tsconfig: "tsconfig.rollup.json",
    }),
    resolve(),
  ],
  external: ["react"],
};

const dtsConfig = {
  input: {
    vanilla: "src/shared/output/vanilla.ts",
    react: "src/shared/output/react.ts",
  },
  output: {
    dir: "dist",
    entryFileNames: "shared/output/[name].d.ts",
  },
  plugins: [
    dts({
      tsconfig: "tsconfig.rollup.json",
    }),
  ],
};

export default [jsConfig, dtsConfig];
