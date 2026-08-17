import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import  terser  from "@rollup/plugin-terser";
import dts from "rollup-plugin-dts";

export default [
  // JS build (ESM)
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.mjs",
      format: "esm",
      sourcemap: true,
    },
    plugins: [nodeResolve(), typescript({ tsconfig: "./tsconfig.json" }), terser()],
    external: ["react"], // put external deps here if any
  },
  // DTS build
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.d.ts",
      format: "esm",
    },
    plugins: [dts()],
  },
];

