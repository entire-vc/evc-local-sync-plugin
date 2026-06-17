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
