import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import replace from "@rollup/plugin-replace";

export default {
  input: {
    index: "src/index.ts",
    "api.worker": "src/shared/workers/api/api.worker.ts",
  },
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].js",
    sourcemap: true,
  },
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        // Point the built main bundle at the emitted worker file in dist
        "../workers/api/api.worker": "./api.worker.js",
      },
    }),
    resolve(),
    typescript({
      tsconfig: "tsconfig.json",
    }),
  ],
  external: ["react"],
};
