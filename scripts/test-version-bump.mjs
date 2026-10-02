import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const files = ["package.json", "package-lock.json", "manifest.json", "manifest-beta.json", "versions.json", "version-bump.mjs"];

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "local-sync-version-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of files) copyFileSync(join(root, name), join(dir, name));
  return dir;
}

// Execute the production CI block so a test cannot drift from its guard.
const ci = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
const block = ci.split("manifest-check:\n")[1].split("    - |\n")[1].split("\n# ── build")[0];
const manifestCheck = block.replace(/^ {6}/gm, "");

function check(dir) {
  const result = spawnSync("sh", ["-c", manifestCheck], { cwd: dir, encoding: "utf8", timeout: 30_000 });
  assert.ifError(result.error);
  return result;
}

test("manifest-check accepts matching versions and rejects stale or missing beta", (t) => {
  const dir = fixture(t);
  assert.equal(check(dir).status, 0);
  const path = join(dir, "manifest-beta.json");
  const beta = JSON.parse(readFileSync(path, "utf8"));
  beta.version = "0.0.0";
  writeFileSync(path, JSON.stringify(beta));
  const stale = check(dir);
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /REFUSING: manifest-beta\.json version \(0\.0\.0\)/);
  rmSync(path);
  const missing = check(dir);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Cannot find module '\.\/manifest-beta\.json'/);
});

test("npm version updates both manifests and compatibility without changing metadata or formatting", (t) => {
  const dir = fixture(t);
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  const before = {};
  for (const name of ["manifest.json", "manifest-beta.json", "versions.json"]) {
    before[name] = readFileSync(join(dir, name), "utf8");
  }
  const current = JSON.parse(before["manifest.json"]);
  const target = "99.0.0";
  execFileSync("npm", ["version", target, "--no-git-tag-version"], { cwd: dir, timeout: 30_000 });
  assert.equal(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version, target);
  for (const name of Object.keys(before)) {
    const expected = JSON.parse(before[name]);
    if (name === "versions.json") expected[target] = current.minAppVersion;
    else expected.version = target;
    const indent = before[name].match(/^\{\r?\n([ \t]+)/)[1];
    const newline = before[name].endsWith("\n") ? "\n" : "";
    assert.equal(readFileSync(join(dir, name), "utf8"), JSON.stringify(expected, null, indent) + newline);
  }
  const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: dir, encoding: "utf8" });
  for (const name of ["manifest.json", "manifest-beta.json", "versions.json"]) assert.ok(staged.split("\n").includes(name));
  assert.equal(check(dir).status, 0);
});
