/**
 * Integration test: the startup sync cycle leaves a real, readable trace in
 * sync-log.json (#94002fd9).
 *
 * Live-storage measurement (parent #3bb939c5) showed files being written by a
 * `syncOnStartup: true` cycle while sync-log.json's mtime never moved — the
 * next storage audit had no choice but manual birthtime/cmp archaeology
 * because the log gave zero signal that a cycle had even run.
 *
 * This exercises the exact glue `EVCLocalSyncPlugin.syncAllProjects(mode)`
 * runs in src/main.ts — logger.logCycleStart(mode, mappings) BEFORE the sync,
 * then engine.syncAll() results logged per-file with `mode` + `targetPath` —
 * without instantiating the full Obsidian Plugin class (main.ts extends
 * Obsidian's `Plugin`, which needs a real plugin-loading lifecycle no test
 * harness here provides; every other integration test in this suite tests
 * SyncEngine directly for the same reason — see syncEngineFlow.test.ts).
 *
 * Reads the actual on-disk sync-log.json the mocked vault adapter wrote, not
 * just the in-memory logger state, so this fails if a future change breaks
 * persistence even though the in-memory array still looks right.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { makeVaultMock } from "../mocks/obsidian";

jest.mock("../../src/obsidian-internal", () => ({
	getVaultBasePath: (app: { _vaultBasePath: string }) => app._vaultBasePath,
	openPluginSettings: jest.fn(),
}));

import { SyncEngine } from "../../src/sync-engine";
import { SyncLogger, DEFAULT_LOGGER_CONFIG, type LogEntry } from "../../src/logger";
import type { EVCLocalSyncSettings, ProjectMapping } from "../../src/settings";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "evc-ls-startuplog-"));
}

function writeFile(dir: string, relPath: string, content: string): void {
	const abs = path.join(dir, relPath);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf-8");
}

function makeSettings(overrides: Partial<EVCLocalSyncSettings> = {}): EVCLocalSyncSettings {
	return {
		version: "1.0",
		syncMode: "manual",
		syncOnStartup: true,
		debounceMs: 100,
		scheduledIntervalMinutes: 60,
		conflictResolution: "newer-wins",
		fileTypes: [".md", ".txt"],
		excludePatterns: [],
		syncDeletions: false,
		confirmDeletions: false,
		createBackups: false,
		logRetentionDays: 7,
		mappings: [],
		...overrides,
	} as EVCLocalSyncSettings;
}

function makeMapping(aiPath: string, obsPath: string, overrides: Partial<ProjectMapping> = {}): ProjectMapping {
	return {
		id: "startup-log-mapping",
		name: "Startup Log Mapping",
		aiPath,
		obsidianPath: obsPath,
		docsSubdir: "",
		syncEnabled: true,
		bidirectional: false,
		syncDirection: "ai-to-obs",
		...overrides,
	};
}

/**
 * Reproduces exactly the glue in `EVCLocalSyncPlugin.syncAllProjects(mode)`
 * (src/main.ts): logCycleStart() BEFORE the sync, then per-file log() after,
 * both carrying `mode`. This glue itself is trivial and untested directly
 * (main.ts extends Obsidian's Plugin, which no harness here can instantiate —
 * every other integration test in this suite tests SyncEngine directly for
 * the same reason, see syncEngineFlow.test.ts). What IS real production code
 * under test: SyncEngine populating `SyncFileResult.targetPath` on every
 * write, and SyncLogger.logCycleStart()/log() actually persisting mode +
 * targetPath to sync-log.json on disk — that's what the red control below
 * exercises, by reverting those two files and re-running this exact test.
 */
async function runSyncCycle(
	engine: SyncEngine,
	logger: SyncLogger,
	mode: "startup" | "manual",
	mappings: ProjectMapping[]
): Promise<void> {
	logger.logCycleStart(mode, mappings);
	const results = await engine.syncAll();
	for (const result of results) {
		for (const fileResult of result.files) {
			logger.log({
				mode,
				direction: fileResult.direction,
				mappingId: result.mapping.id,
				mappingName: result.mapping.name,
				file: fileResult.file,
				targetPath: fileResult.targetPath,
				action: fileResult.action,
				success: fileResult.success,
				error: fileResult.error,
			});
		}
	}
}

describe("Integration: startup sync cycle is visible in sync-log.json (#94002fd9)", () => {
	let aiDir: string;
	let vaultDir: string;
	let engine: SyncEngine;
	let logger: SyncLogger;
	let mapping: ProjectMapping;
	let vault: ReturnType<typeof makeVaultMock>;
	let app: import("obsidian").App;

	beforeEach(async () => {
		aiDir = makeTempDir();
		vaultDir = makeTempDir();
		vault = makeVaultMock(vaultDir);
		app = { vault, _vaultBasePath: vaultDir } as unknown as import("obsidian").App;

		writeFile(aiDir, "specs/auth-flows.md", "# Auth flows spec");
		writeFile(aiDir, "issues/001-something.md", "# Issue 001");

		mapping = makeMapping(aiDir, "Product/docs/dev-docs");
		const settings = makeSettings({ mappings: [mapping] });

		engine = new SyncEngine(app, settings, "/tmp/evc-ls-plugin");
		await engine.init();

		logger = new SyncLogger(app as unknown as ConstructorParameters<typeof SyncLogger>[0], {
			...DEFAULT_LOGGER_CONFIG,
			retentionDays: 7,
		});
		await logger.load();
	});

	afterEach(() => {
		fs.rmSync(aiDir, { recursive: true, force: true });
		fs.rmSync(vaultDir, { recursive: true, force: true });
	});

	function readOnDiskLog(): { entries: LogEntry[] } {
		const logPath = path.join(vaultDir, ".obsidian", "plugins", "evc-local-sync", "sync-log.json");
		expect(fs.existsSync(logPath)).toBe(true);
		const raw = JSON.parse(fs.readFileSync(logPath, "utf-8")) as { entries: LogEntry[] };
		return raw;
	}

	test("GREEN: a startup cycle writes a mode=startup cycle-start marker AND per-file entries with matching target paths", async () => {
		await runSyncCycle(engine, logger, "startup", [mapping]);

		// The file writes actually happened on disk — otherwise this test would
		// pass for the wrong reason (nothing to log because nothing was written).
		expect(fs.existsSync(path.join(vaultDir, "Product/docs/dev-docs/specs/auth-flows.md"))).toBe(true);
		expect(fs.existsSync(path.join(vaultDir, "Product/docs/dev-docs/issues/001-something.md"))).toBe(true);

		const onDisk = readOnDiskLog();
		const startupEntries = onDisk.entries.filter((e) => e.mode === "startup");
		expect(startupEntries.length).toBeGreaterThan(0);

		// Criterion: a cycle-start marker exists, naming the mode and the mapping list.
		const cycleMarker = startupEntries.find((e) => e.action === "cycle-start");
		expect(cycleMarker).toBeDefined();
		expect(cycleMarker?.mappingNames).toEqual(["Startup Log Mapping"]);

		// Criterion: the list of written files is non-empty — "a record exists" is
		// not the bar, its CONTENT is (§0x — a check that can pass on nothing proves
		// nothing).
		const fileEntries = startupEntries.filter((e) => e.action === "copy" && e.success);
		expect(fileEntries.length).toBe(2);

		// Criterion: the target path matches what was ACTUALLY written, not a
		// recomputation that could drift from the real write — the whole point
		// being able to tell docs/ from docs/dev-docs/ apart in the log.
		const authFlowsEntry = fileEntries.find((e) => e.file === "specs/auth-flows.md");
		expect(authFlowsEntry).toBeDefined();
		expect(authFlowsEntry?.targetPath).toBe("Product/docs/dev-docs/specs/auth-flows.md");
		expect(fs.existsSync(path.join(vaultDir, authFlowsEntry!.targetPath!))).toBe(true);

		const issueEntry = fileEntries.find((e) => e.file === "issues/001-something.md");
		expect(issueEntry).toBeDefined();
		expect(issueEntry?.targetPath).toBe("Product/docs/dev-docs/issues/001-something.md");
		expect(fs.existsSync(path.join(vaultDir, issueEntry!.targetPath!))).toBe(true);
	});

	test("GREEN: a startup cycle that copies nothing (already in sync) still leaves the cycle-start marker", async () => {
		// First cycle actually copies the files…
		await runSyncCycle(engine, logger, "startup", [mapping]);
		// …a second startup cycle immediately after has nothing new to do (same
		// mtimes) — this is the exact shape of the original bug: a no-op run must
		// still be provably distinguishable from "the cycle never ran at all".
		await runSyncCycle(engine, logger, "startup", [mapping]);

		const onDisk = readOnDiskLog();
		const cycleMarkers = onDisk.entries.filter((e) => e.mode === "startup" && e.action === "cycle-start");
		expect(cycleMarkers.length).toBe(2);
	});
});

// Red control for this file (run manually, not part of CI): stash the
// targetPath plumbing in src/sync-engine.ts (WriteOutcome/SyncFileResult/the
// copyFileTo* return sites) and src/logger.ts (logCycleStart, the mode/
// targetPath fields) and re-run the GREEN tests above — they must fail. See
// the closing task comment for the actual red/green transcript.
