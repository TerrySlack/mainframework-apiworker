import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import replace from "@rollup/plugin-replace";

export default {
  input: {
    vanilla: "src/shared/output/vanilla.ts",
    react: "src/shared/output/react.ts",
    "api.worker": "src/shared/workers/api/api.worker.ts",
  },
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: (chunkInfo) =>
      chunkInfo.name === "api.worker" ? "[name].js" : "shared/output/[name].js",
    sourcemap: true,
  },
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        // Strip "use client" - module level directives cause errors when bundled
        '"use client";': "",
      },
    }),
    resolve(),
    typescript({
      tsconfig: "tsconfig.rollup.json",
    }),
  ],
  external: ["react"],
};
