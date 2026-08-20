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
