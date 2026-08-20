/**
 * Integration tests: SyncEngine file sync flow.
 *
 * Uses real temporary directories for both AI project side and vault side.
 * Mocks only the obsidian module (true external boundary — no Obsidian runtime
 * available in CI). Covers:
 *   (1) AI→Obs: new files from AI project are copied into the vault
 *   (2) AI→Obs: files with same mtime are skipped (no re-copy)
 *   (3) path-utils: expandHome expands tilde correctly
 */

import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { makeVaultMock } from "../mocks/obsidian";

// obsidian module is redirected to __tests__/mocks/obsidian.ts via moduleNameMapper in jest.config.js

// Mock obsidian-internal so getVaultBasePath returns our temp vault dir
jest.mock("../../src/obsidian-internal", () => ({
	getVaultBasePath: (app: { _vaultBasePath: string }) => app._vaultBasePath,
	openPluginSettings: jest.fn(),
}));

import { SyncEngine } from "../../src/sync-engine";
import type { EVCLocalSyncSettings, ProjectMapping } from "../../src/settings";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "evc-ls-test-"));
}

function writeFile(dir: string, relPath: string, content: string): void {
	const abs = path.join(dir, relPath);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf-8");
}

function readFile(dir: string, relPath: string): string {
	return fs.readFileSync(path.join(dir, relPath), "utf-8");
}

function fileExists(dir: string, relPath: string): boolean {
	return fs.existsSync(path.join(dir, relPath));
}

function rmDir(dir: string): void {
	fs.rmSync(dir, { recursive: true, force: true });
}

function makeSettings(overrides: Partial<EVCLocalSyncSettings> = {}): EVCLocalSyncSettings {
	return {
		version: "1.0",
		syncMode: "manual",
		syncOnStartup: false,
		debounceMs: 100,
		scheduledIntervalMinutes: 60,
		conflictResolution: "newer-wins",
		fileTypes: [".md", ".txt"],
		excludePatterns: [],
		syncDeletions: false,
		confirmDeletions: false,
		createBackups: false,
		mappings: [],
		...overrides,
	} as EVCLocalSyncSettings;
}

function makeMapping(aiPath: string, obsPath: string, overrides: Partial<ProjectMapping> = {}): ProjectMapping {
	return {
		id: "test-mapping-001",
		name: "Test Mapping",
		aiPath,
		obsidianPath: obsPath,
		docsSubdir: "",
		syncEnabled: true,
		bidirectional: false,
		syncDirection: "ai-to-obs",
		...overrides,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Integration: SyncEngine AI→Obs file copy flow", () => {
	let aiDir: string;
	let vaultDir: string;
	let engine: SyncEngine;
	let vault: ReturnType<typeof makeVaultMock>;

	beforeEach(async () => {
		aiDir = makeTempDir();
		vaultDir = makeTempDir();
		vault = makeVaultMock(vaultDir);

		const app = { vault, _vaultBasePath: vaultDir } as unknown as import("obsidian").App;
		const settings = makeSettings({ mappings: [] });
		engine = new SyncEngine(app, settings, "/tmp/evc-ls-plugin");
		await engine.init();
	});

	afterEach(() => {
		rmDir(aiDir);
		rmDir(vaultDir);
	});

	test("copies new markdown file from AI project into vault", async () => {
		writeFile(aiDir, "architecture.md", "# Architecture\n\nSystem design notes.");
		writeFile(aiDir, "notes/api.md", "## API\n\nREST endpoints.");

		const mapping = makeMapping(aiDir, "project-docs");
		const result = await engine.syncMapping(mapping);

		expect(result.success).toBe(true);
		expect(result.filesCopied).toBeGreaterThanOrEqual(2);
		expect(result.errors).toHaveLength(0);

		// Files must appear in the vault temp dir
		expect(fileExists(vaultDir, "project-docs/architecture.md")).toBe(true);
		expect(fileExists(vaultDir, "project-docs/notes/api.md")).toBe(true);

		// Content must be preserved exactly
		expect(readFile(vaultDir, "project-docs/architecture.md")).toBe("# Architecture\n\nSystem design notes.");
		expect(readFile(vaultDir, "project-docs/notes/api.md")).toBe("## API\n\nREST endpoints.");
	});

	test("skips non-matching file extensions (.json is excluded by default)", async () => {
		writeFile(aiDir, "data.json", '{"key":"value"}');
		writeFile(aiDir, "readme.md", "# Readme");

		const mapping = makeMapping(aiDir, "project-docs");
		const result = await engine.syncMapping(mapping);

		expect(result.success).toBe(true);
		// Only .md file should be copied — .json excluded by default fileTypes
		expect(fileExists(vaultDir, "project-docs/readme.md")).toBe(true);
		expect(fileExists(vaultDir, "project-docs/data.json")).toBe(false);
	});

	test("sync result contains per-file action records", async () => {
		writeFile(aiDir, "doc.md", "# Doc");

		const mapping = makeMapping(aiDir, "project-docs");
		const result = await engine.syncMapping(mapping);

		expect(result.files.length).toBeGreaterThan(0);
		const docResult = result.files.find((f) => f.file.endsWith("doc.md"));
		expect(docResult).toBeDefined();
		expect(docResult?.action).toBe("copy");
		expect(docResult?.direction).toBe("ai-to-obs");
		expect(docResult?.success).toBe(true);
	});

	test("disabled mapping is not synced (syncEnabled=false)", async () => {
		writeFile(aiDir, "notes.md", "Important notes");

		const mapping = makeMapping(aiDir, "project-docs", { syncEnabled: false });
		// syncAll skips disabled mappings; syncMapping respects the flag via settings.mappings
		// Test directly: a mapping with syncEnabled=false should report success but 0 copies
		// (engine.syncMapping is called by syncAll which pre-filters; calling directly still syncs)
		// Instead, test via syncAll with disabled mapping in settings
		const settings = makeSettings({ mappings: [mapping] });
		engine.updateSettings(settings);

		const results = await engine.syncAll();
		expect(results).toHaveLength(0); // syncAll filters out disabled mappings
		expect(fileExists(vaultDir, "project-docs/notes.md")).toBe(false);
	});

	test("fails gracefully when AI path does not exist", async () => {
		const mapping = makeMapping("/nonexistent/path/that/does/not/exist", "project-docs");

		const result = await engine.syncMapping(mapping);

		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
	});
});

describe("Integration: overlapping bidirectional mappings must not nest docs/docs", () => {
	let aiDirA: string;
	let aiDirB: string;
	let vaultDir: string;
	let engine: SyncEngine;
	let vault: ReturnType<typeof makeVaultMock>;

	// Count every file under a directory tree (recursive).
	function countFiles(dir: string): number {
		let count = 0;
		const walk = (d: string): void => {
			for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
				const p = path.join(d, entry.name);
				if (entry.isDirectory()) {
					walk(p);
				} else {
					count++;
				}
			}
		};
		if (fs.existsSync(dir)) {
			walk(dir);
		}
		return count;
	}

	// Collect every path (relative to root) that exists under a tree.
	function allPaths(dir: string): string[] {
		const out: string[] = [];
		const walk = (d: string, rel: string): void => {
			for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
				const childRel = rel ? `${rel}/${entry.name}` : entry.name;
				const p = path.join(d, entry.name);
				out.push(childRel);
				if (entry.isDirectory()) {
					walk(p, childRel);
				}
			}
		};
		if (fs.existsSync(dir)) {
			walk(dir, "");
		}
		return out;
	}

	beforeEach(async () => {
		// Two AI roots that both end in "/docs" (the segment that runs away).
		aiDirA = path.join(makeTempDir(), "docs");
		aiDirB = path.join(makeTempDir(), "docs");
		fs.mkdirSync(aiDirA, { recursive: true });
		fs.mkdirSync(aiDirB, { recursive: true });
		vaultDir = makeTempDir();
		vault = makeVaultMock(vaultDir);

		const app = { vault, _vaultBasePath: vaultDir } as unknown as import("obsidian").App;

		// Mapping A: aiDirA <-> vault "Proj"
		// Mapping B: aiDirB <-> vault "Proj/Sub"  (nested UNDER A's vault root)
		const mappingA = makeMapping(aiDirA, "Proj", {
			id: "map-A",
			name: "Proj",
			bidirectional: true,
			syncDirection: undefined,
			docsSubdir: "",
		});
		const mappingB = makeMapping(aiDirB, "Proj/Sub", {
			id: "map-B",
			name: "Proj-Sub",
			bidirectional: true,
			syncDirection: undefined,
			docsSubdir: "",
		});

		const settings = makeSettings({ mappings: [mappingA, mappingB] });
		engine = new SyncEngine(app, settings, "/tmp/evc-ls-plugin");
		await engine.init();
	});

	afterEach(() => {
		rmDir(path.dirname(aiDirA));
		rmDir(path.dirname(aiDirB));
		rmDir(vaultDir);
	});

	test("running syncAll repeatedly never creates docs/docs nesting and stays bounded", async () => {
		// Seed one .md in each AI root and in the nested vault target.
		writeFile(aiDirA, "a.md", "# A");
		writeFile(aiDirB, "b.md", "# B");
		writeFile(vaultDir, "Proj/Sub/seed.md", "# Seed");

		for (let i = 0; i < 5; i++) {
			await engine.syncAll();
		}

		// No path anywhere under the vault may contain the "docs/docs" signature,
		// nor may a "Proj/docs" folder appear (would mean A swallowed its own/B's tree).
		const vaultPaths = allPaths(vaultDir);
		for (const p of vaultPaths) {
			expect(p.includes("docs/docs")).toBe(false);
		}
		expect(fs.existsSync(path.join(vaultDir, "Proj", "docs"))).toBe(false);

		// AI roots must not have grown a nested "docs/docs" either.
		for (const p of [...allPaths(aiDirA), ...allPaths(aiDirB)]) {
			expect(p.includes("docs/docs")).toBe(false);
		}

		// File counts must stay bounded (not grow per iteration / runaway).
		// Generous upper bounds — the bug produced unbounded growth across 5 cycles.
		expect(countFiles(aiDirA)).toBeLessThanOrEqual(10);
		expect(countFiles(aiDirB)).toBeLessThanOrEqual(10);
		expect(countFiles(vaultDir)).toBeLessThanOrEqual(20);
	});
});

describe("Integration: docsSubdir-fold self-nesting (#9d86c756)", () => {
	// Reproduces the real incident: a mapping originally configured as
	// aiPath="<project>", docsSubdir="dev-docs" gets its docsSubdir folded into
	// aiPath ("<project>/dev-docs", docsSubdir="") without the Obsidian side
	// changing. The AI root's own basename ("dev-docs") then equals the name of a
	// leftover duplicate folder that already exists deeper in the AI tree from
	// before the #14 guard existed — a destination-only basename check misses this
	// because the Obsidian *destination* root's basename ("docs") never matches.
	let aiProjectRoot: string;
	let vaultDir: string;
	let engine: SyncEngine;
	let vault: ReturnType<typeof makeVaultMock>;
	let aiDocsPath: string; // "<aiProjectRoot>/dev-docs" — the folded aiPath

	beforeEach(async () => {
		aiProjectRoot = makeTempDir();
		vaultDir = makeTempDir();
		vault = makeVaultMock(vaultDir);
		aiDocsPath = path.join(aiProjectRoot, "dev-docs");

		const app = { vault, _vaultBasePath: vaultDir } as unknown as import("obsidian").App;
		engine = new SyncEngine(app, makeSettings({ mappings: [] }), "/tmp/evc-ls-plugin");
		await engine.init();
	});

	afterEach(() => {
		rmDir(aiProjectRoot);
		rmDir(vaultDir);
	});

	test("does not resurrect a same-named leftover subtree into the Obsidian side after it was deleted by hand", async () => {
		// Legit content that should sync normally.
		writeFile(aiDocsPath, "readme.md", "# Docs");
		// Pre-existing leftover duplicate on the AI side only (simulates content
		// created by the old bug before the #14 guard existed; the Obsidian-side
		// copy was already deleted by hand — the 2026-05-25 cleanup attempt).
		writeFile(aiDocsPath, "dev-docs/a.md", "# Duplicate");

		const mapping = makeMapping(aiDocsPath, "docs", {
			id: "map-fold",
			name: "TR docs (folded)",
			docsSubdir: "",
			bidirectional: true,
			syncDirection: undefined,
		});

		await engine.syncMapping(mapping);

		// Normal content still syncs.
		expect(fileExists(vaultDir, "docs/readme.md")).toBe(true);
		// The leftover must NOT be resurrected into the vault.
		expect(fileExists(vaultDir, "docs/dev-docs/a.md")).toBe(false);
		expect(fs.existsSync(path.join(vaultDir, "docs", "dev-docs"))).toBe(false);
	});

	test("does not propagate a same-named leftover subtree from Obsidian back into the AI side", async () => {
		// Mirror case: the leftover duplicate sits on the Obsidian side instead,
		// and the AI side's own root basename ("dev-docs") matches it — the
		// pre-existing #14 guard already caught this direction (destination
		// basename == segment), this test locks that in as a regression guard now
		// that the check has been refactored into a shared helper.
		writeFile(vaultDir, "docs/readme.md", "# Docs");
		writeFile(vaultDir, "docs/dev-docs/a.md", "# Duplicate");
		fs.mkdirSync(aiDocsPath, { recursive: true });

		const mapping = makeMapping(aiDocsPath, "docs", {
			id: "map-fold-2",
			name: "TR docs (folded, reverse)",
			docsSubdir: "",
			bidirectional: true,
			syncDirection: undefined,
		});

		await engine.syncMapping(mapping);

		expect(fileExists(aiDocsPath, "readme.md")).toBe(true);
		expect(fs.existsSync(path.join(aiDocsPath, "dev-docs"))).toBe(false);
	});
});

describe("Integration: shared-docsSubdir shadow duplicate (#3bb939c5 — #58/1.3.4 did not hold)", () => {
	// Reproduces the LIVE incident measured on Pavel's vault after release 1.3.4:
	// #58 widened the self-nesting guard to compare a write's relativePath
	// against BOTH mapping roots' basenames — but that only catches a leftover
	// subtree whose name happens to match a *relativePath segment*. Here the
	// offending "dev-docs" segment is the DESTINATION ROOT ITSELF (one level
	// above any relativePath the #58 guard ever inspects): docsSubdir is a
	// single field applied by BOTH getAiDocsPath() and getObsidianDocsPath().
	// A mapping shaped aiPath="<repo>" + docsSubdir="dev-docs" (repo's docs
	// live under dev-docs/) with obsidianPath="Vault/Product/docs" (already the
	// canonical folder) computes obsDocsPath="Vault/Product/docs/dev-docs" —
	// nesting a duplicate one level below the real content, exactly matching
	// the live measurement (Local Sync docs/dev-docs/issues/001-….md,
	// byte-identical to the already-existing docs/issues/001-….md).
	let repoRoot: string;
	let vaultDir: string;
	let engine: SyncEngine;
	let vault: ReturnType<typeof makeVaultMock>;

	beforeEach(async () => {
		repoRoot = makeTempDir();
		vaultDir = makeTempDir();
		vault = makeVaultMock(vaultDir);
		const app = { vault, _vaultBasePath: vaultDir } as unknown as import("obsidian").App;
		engine = new SyncEngine(app, makeSettings({ mappings: [] }), "/tmp/evc-ls-plugin");
		await engine.init();
	});

	afterEach(() => {
		rmDir(repoRoot);
		rmDir(vaultDir);
	});

	test("does not recreate docs/dev-docs when the same files already exist one level up (ai-to-obs)", async () => {
		// Repo's real content root is repoRoot/dev-docs (docsSubdir="dev-docs").
		// Multiple files, matching the live incident: the ENTIRE tree resurrected
		// at once (specs/guides/adrs/issues/… — not a single file), which is
		// exactly the "majority of the tree matches" signal the detector requires.
		writeFile(repoRoot, "dev-docs/issues/a.md", "# A, 846-ish bytes of content");
		writeFile(repoRoot, "dev-docs/specs/b.md", "# B, spec content");
		writeFile(repoRoot, "dev-docs/guides/c.md", "# C, guide content");
		// Vault already has the CANONICAL copies directly under Product/docs — this
		// is the already-synced state measured before Obsidian restarted.
		writeFile(vaultDir, "Product/docs/issues/a.md", "# A, 846-ish bytes of content");
		writeFile(vaultDir, "Product/docs/specs/b.md", "# B, spec content");
		writeFile(vaultDir, "Product/docs/guides/c.md", "# C, guide content");

		const mapping = makeMapping(repoRoot, "Product/docs", {
			id: "map-shadow",
			name: "Product docs",
			docsSubdir: "dev-docs",
			bidirectional: true,
			syncDirection: undefined,
		});

		const result = await engine.syncMapping(mapping);

		expect(result.success).toBe(true);
		expect(fs.existsSync(path.join(vaultDir, "Product", "docs", "dev-docs"))).toBe(false);
		// The canonical copies must be untouched, not duplicated.
		expect(fileExists(vaultDir, "Product/docs/issues/a.md")).toBe(true);
		expect(fileExists(vaultDir, "Product/docs/specs/b.md")).toBe(true);
		expect(fileExists(vaultDir, "Product/docs/guides/c.md")).toBe(true);

		// #3bb939c5 follow-up: a guard-skipped write must be recorded as a "skip",
		// not silently reported as a successful "copy" — the previous behavior made
		// sync-log.json (and filesCopied) claim these 3 files were copied even
		// though the guard no-op'd every one of them, hiding the guard's own
		// activity from the only persisted record of what actually happened.
		expect(result.filesCopied).toBe(0);
		expect(result.filesSkipped).toBe(3);
		const skippedNames = result.files.filter((f) => f.action === "skip").map((f) => f.file).sort();
		expect(skippedNames).toEqual(["guides/c.md", "issues/a.md", "specs/b.md"]);
		expect(result.files.some((f) => f.action === "copy")).toBe(false);
	});

	test("mirror case: does not recreate a shadow duplicate on the AI side (obs-to-ai)", async () => {
		// This time the AI side's raw aiPath is itself pre-folded to the (already
		// correct) content root, so re-applying docsSubdir nests an extra shadow
		// level BELOW it — the mirror of the ai-to-obs shape above. obsidianPath is
		// left unfolded, so the obs side computes correctly.
		const shadowAiRoot = path.join(repoRoot, "dev-docs", "dev-docs");
		fs.mkdirSync(shadowAiRoot, { recursive: true }); // exists, but starts empty
		// The TRUE, already-correct AI content lives one level up from the shadow root.
		writeFile(repoRoot, "dev-docs/a.md", "content A");
		writeFile(repoRoot, "dev-docs/b.md", "content B");
		writeFile(repoRoot, "dev-docs/c.md", "content C");
		// The vault (obs) side has the same logical content, matching what's
		// already correctly on the AI side — this is what would get copied INTO
		// the AI shadow root without the fix.
		writeFile(vaultDir, "Product/dev-docs/a.md", "content A");
		writeFile(vaultDir, "Product/dev-docs/b.md", "content B");
		writeFile(vaultDir, "Product/dev-docs/c.md", "content C");

		const mapping = makeMapping(path.join(repoRoot, "dev-docs"), "Product", {
			id: "map-shadow-mirror",
			name: "Product docs (mirror)",
			docsSubdir: "dev-docs",
			bidirectional: true,
			syncDirection: undefined,
		});

		await engine.syncMapping(mapping);

		// The shadow root exists (created above) but must stay empty — nothing
		// should have been duplicated into it.
		expect(fs.readdirSync(shadowAiRoot)).toEqual([]);
		// The true, already-correct content one level up is untouched.
		expect(fileExists(repoRoot, "dev-docs/a.md")).toBe(true);
		expect(fileExists(repoRoot, "dev-docs/b.md")).toBe(true);
		expect(fileExists(repoRoot, "dev-docs/c.md")).toBe(true);
	});

	test("negative control: a genuinely new file (no matching sibling one level up) still syncs normally", async () => {
		// Same double-applied-docsSubdir shape, but the file is NOT a pre-existing
		// duplicate — nothing sits at "Product/docs/new-file.md" yet. Confirms the
		// guard isn't blanket-blocking every write into a docsSubdir-named root,
		// only writes that would duplicate already-synced content.
		writeFile(repoRoot, "dev-docs/new-file.md", "# Brand new");

		const mapping = makeMapping(repoRoot, "Product/docs", {
			id: "map-shadow-negative",
			name: "Product docs (negative control)",
			docsSubdir: "dev-docs",
			bidirectional: true,
			syncDirection: undefined,
		});

		const result = await engine.syncMapping(mapping);

		expect(result.success).toBe(true);
		expect(fileExists(vaultDir, "Product/docs/dev-docs/new-file.md")).toBe(true);
	});

	test("negative control: same relative path but DIFFERENT content one level up still syncs (size mismatch is not treated as a shadow)", async () => {
		writeFile(repoRoot, "dev-docs/issues/a.md", "# Genuinely different content, much longer than the sibling");
		writeFile(vaultDir, "Product/docs/issues/a.md", "# short");

		const mapping = makeMapping(repoRoot, "Product/docs", {
			id: "map-shadow-size-mismatch",
			name: "Product docs (size mismatch)",
			docsSubdir: "dev-docs",
			bidirectional: true,
			syncDirection: undefined,
		});

		await engine.syncMapping(mapping);

		// Sizes differ from the "canonical" sibling, so this is treated as a real,
		// distinct file rather than a shadow duplicate, and is copied through.
		expect(fileExists(vaultDir, "Product/docs/dev-docs/issues/a.md")).toBe(true);
	});

	test("negative control: a single coincidental content-identical match in the plugin's own DEFAULT mapping shape does not block the rest of the sync", async () => {
		// This is the exact false-positive class an earlier (size-only, per-file)
		// version of this guard was rejected for on independent verification:
		// docsSubdir="docs" is the plugin's own new-mapping default (see
		// mapping-modal.ts), so `basename(destRoot) === docsSubdir` is true for
		// the MOST COMMON mapping shape, not just a folded/buggy one. A lone
		// coincidental match (e.g. two unrelated folders both shipping a
		// byte-identical boilerplate LICENSE.md) must not silently drop the rest
		// of an otherwise-legitimate, non-shadowed sync.
		writeFile(repoRoot, "docs/LICENSE.md", "MIT License boilerplate, identical everywhere");
		writeFile(repoRoot, "docs/architecture.md", "# Real, new architecture notes");
		writeFile(repoRoot, "docs/api.md", "# Real, new API notes");
		// Vault "Product" (the mapping's PARENT folder, one level up from the
		// correctly-computed obsDocsPath="Product/docs") happens to already have
		// an unrelated file with the exact same relative path AND content —
		// pure coincidence, not evidence of a docsSubdir fold.
		writeFile(vaultDir, "Product/LICENSE.md", "MIT License boilerplate, identical everywhere");

		const mapping = makeMapping(repoRoot, "Product", {
			id: "map-default-shape-coincidence",
			name: "Product (default shape, one coincidental match)",
			docsSubdir: "docs", // the plugin's own default — NOT a folded/buggy mapping
			bidirectional: true,
			syncDirection: undefined,
		});

		const result = await engine.syncMapping(mapping);

		expect(result.success).toBe(true);
		// The lone coincidental match must not veto the rest of the sync.
		expect(fileExists(vaultDir, "Product/docs/architecture.md")).toBe(true);
		expect(fileExists(vaultDir, "Product/docs/api.md")).toBe(true);
		expect(fileExists(vaultDir, "Product/docs/LICENSE.md")).toBe(true);
	});
});

describe("Integration: path-utils expandHome", () => {
	test("expands ~ to HOME directory", () => {
		// Import after mock setup
		const { expandHome } = require("../../src/path-utils");
		const home = process.env.HOME ?? "/root";
		expect(expandHome("~/Documents/project")).toBe(`${home}/Documents/project`);
	});

	test("leaves absolute paths unchanged", () => {
		const { expandHome } = require("../../src/path-utils");
		expect(expandHome("/absolute/path")).toBe("/absolute/path");
	});

	test("leaves relative paths unchanged", () => {
		const { expandHome } = require("../../src/path-utils");
		expect(expandHome("relative/path")).toBe("relative/path");
	});
});
