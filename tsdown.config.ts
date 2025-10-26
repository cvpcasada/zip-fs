import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  outDir: "./dist",
  format: ["esm", "cjs"],
  target: "esnext",
  clean: true,
  tsconfig: "./tsconfig.json",
  dts: {
    oxc: true,
  },
});
