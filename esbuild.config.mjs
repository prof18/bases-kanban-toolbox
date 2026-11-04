import esbuild from "esbuild";
import { builtinModules } from "node:module";
import process from "node:process";

const production = process.argv[2] === "production";
const context = await esbuild.context({
  entryPoints: ["src/main.js"],
  bundle: true,
  external: ["obsidian", "electron", ...builtinModules],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  outfile: "main.js",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
