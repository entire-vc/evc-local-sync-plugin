// Bundles entry.ts into dist-smoke/watcher-smoke.js with the same target/format
// and Node-builtin externals as esbuild.config.mjs. `obsidian` is stubbed: the
// watcher only needs types from it, but settings.ts imports runtime classes.
import esbuild from "esbuild";
import { builtinModules } from "module";

await esbuild.build({
  entryPoints: ["scripts/watcher-smoke/entry.ts"],
  bundle: true,
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`), "fsevents"],
  format: "cjs",
  platform: "node",
  target: "es2018",
  minify: true,
  outfile: "dist-smoke/watcher-smoke.js",
  plugins: [{
    name: "obsidian-stub",
    setup(b) {
      b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
        contents: "module.exports = new Proxy({}, { get: (_t, k) => (k === '__esModule' ? false : class {}) });",
        loader: "js",
      }));
    },
  }],
});
