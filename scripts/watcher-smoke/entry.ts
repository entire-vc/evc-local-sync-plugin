// Drives the real FileWatcher through create / edit / rename / delete (native
// backend, AI side) and create / edit (polling backend, vault side). Bundled by
// build.mjs with the plugin's own esbuild settings, so chokidar is inlined the
// way it ships in main.js; the bundle then runs on the oldest Node we claim.
import { FileWatcher } from "../../src/file-watcher";
import { DEFAULT_SETTINGS } from "../../src/settings";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

(globalThis as unknown as { window: unknown }).window = globalThis;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

void (async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lsw-"));
  const ai = path.join(root, "ai");
  const vault = path.join(root, "vault");
  fs.mkdirSync(ai);
  fs.mkdirSync(path.join(vault, "notes"), { recursive: true });
  const mapping = { id: "m1", name: "t", aiPath: ai, obsidianPath: "notes", docsSubdir: "", syncEnabled: true, bidirectional: true };
  const app = { vault: { adapter: { basePath: vault } } };
  const settings = { ...DEFAULT_SETTINGS, mappings: [mapping], syncMode: "on-change", debounceMs: 200 };
  const w = new FileWatcher(app as never, settings as never);
  const seen: string[] = [];
  // Unlinks are not synced by design (NFR-020); the watcher only logs them.
  const origDebug = console.debug;
  console.debug = (...a: unknown[]) => {
    const m = /File removed \(not synced\): (.+)$/.exec(String(a[0]));
    if (m) seen.push(`ai:unlink:${m[1]}`);
    origDebug(...a);
  };
  w.onFileChange((evs) => evs.forEach((e) => seen.push(`${e.source}:${e.type}:${e.relativePath}`)));
  if (process.env.WATCHER_SMOKE_NO_START !== "1") w.start(); // =1 is the red control
  await sleep(1500);
  fs.writeFileSync(path.join(ai, "a.md"), "1");
  await sleep(1500);
  fs.writeFileSync(path.join(ai, "a.md"), "2");
  await sleep(1500);
  fs.renameSync(path.join(ai, "a.md"), path.join(ai, "b.md"));
  await sleep(1500);
  fs.unlinkSync(path.join(ai, "b.md"));
  await sleep(1000);
  fs.writeFileSync(path.join(vault, "notes", "p.md"), "1");
  await sleep(3500);
  fs.writeFileSync(path.join(vault, "notes", "p.md"), "22");
  await sleep(3500);
  await w.stop();
  const want = ["ai:add:a.md", "ai:change:a.md", "ai:add:b.md", "ai:unlink:b.md", "obsidian:add:p.md", "obsidian:change:p.md"];
  const missing = want.filter((x) => !seen.includes(x));
  console.log(`watcher-smoke node ${process.version} seen=${JSON.stringify(seen)} missing=${JSON.stringify(missing)}`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(missing.length ? 1 : 0);
})();
