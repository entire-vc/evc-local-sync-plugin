/**
 * Integration test: FileWatcher against the real chokidar and a real temp
 * filesystem.
 *
 * The watcher is the core of on-change sync, and chokidar is the one runtime
 * dependency under it. Majors of chokidar have changed what the `ignored`
 * callback receives (glob targets dropped in 4, the observation pipeline
 * rewritten in 6, polling replaced with chokidar-owned stat loops). None of
 * that is visible to the unit tests, which never start a watcher. This test
 * does: it creates, changes, renames and nests files on disk and asserts the
 * events that reach `onFileChange` — for both the native backend (AI side)
 * and the polling backend (Obsidian side) — plus the filters that must keep
 * non-synced paths out.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { makeVaultMock } from "../mocks/obsidian";

jest.mock("../../src/obsidian-internal", () => ({
	getVaultBasePath: (app: { _vaultBasePath: string }) => app._vaultBasePath,
	openPluginSettings: jest.fn(),
}));

import { FileWatcher, type FileChangeEvent } from "../../src/file-watcher";
import type { EVCLocalSyncSettings, ProjectMapping } from "../../src/settings";
import type { App } from "obsidian";

jest.setTimeout(30000);

beforeAll(() => {
	// FileWatcher debounces through window.setTimeout (Obsidian renderer).
	(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
});

interface ReadyEmitter {
	once(event: "ready", cb: () => void): unknown;
}

let root: string;
let aiDir: string;
let vaultDir: string;
let watcher: FileWatcher;
let events: FileChangeEvent[];

function makeSettings(): EVCLocalSyncSettings {
	const mapping: ProjectMapping = {
		id: "m1",
		name: "watched",
		aiPath: aiDir,
		obsidianPath: "notes",
		docsSubdir: "",
		syncEnabled: true,
		bidirectional: true,
	};
	return {
		version: "1.0",
		syncMode: "on-change",
		syncOnStartup: false,
		debounceMs: 100,
		scheduledIntervalMinutes: 5,
		conflictResolution: "newer-wins",
		createBackups: false,
		showAutoSyncNotifications: false,
		followSymlinks: false,
		fileTypes: [".md"],
		excludePatterns: ["node_modules"],
		mappings: [mapping],
		logRetentionDays: 7,
		syncDeletions: false,
		confirmDeletions: true,
	};
}

async function startWatcher(): Promise<void> {
	const app = { vault: makeVaultMock(vaultDir), _vaultBasePath: vaultDir } as unknown as App;
	watcher = new FileWatcher(app, makeSettings());
	watcher.onFileChange((batch) => events.push(...batch));
	watcher.start();
	const inner = (watcher as unknown as { watchers: Map<string, ReadyEmitter> }).watchers;
	expect(inner.size).toBe(2);
	await Promise.all(
		[...inner.values()].map((w) => new Promise<void>((resolve) => w.once("ready", resolve)))
	);
}

async function waitFor(pred: () => boolean, timeoutMs = 10000): Promise<void> {
	const started = Date.now();
	while (!pred()) {
		if (Date.now() - started > timeoutMs) {
			throw new Error(`timed out; events so far: ${JSON.stringify(summary())}`);
		}
		await new Promise((r) => setTimeout(r, 50));
	}
}

function summary(): string[] {
	return events.map((e) => `${e.source}:${e.type}:${e.relativePath}`);
}

function has(source: "ai" | "obsidian", type: FileChangeEvent["type"], rel: string): boolean {
	return events.some((e) => e.source === source && e.type === type && e.relativePath === rel);
}

beforeEach(async () => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "evc-ls-watcher-"));
	aiDir = path.join(root, "project", "docs");
	vaultDir = path.join(root, "vault");
	fs.mkdirSync(aiDir, { recursive: true });
	fs.mkdirSync(path.join(vaultDir, "notes"), { recursive: true });
	// Polling detects a new entry by the directory's mtime/size changing. On
	// Linux the mtime comes from a coarse clock (a few ms) and ext4 keeps the
	// directory size constant, so a file written within the same tick as the
	// mkdir above is invisible to the poll. Real watched folders predate the
	// watcher; backdate the fixtures to match.
	const past = new Date(Date.now() - 60_000);
	for (const dir of [aiDir, path.join(vaultDir, "notes")]) {
		fs.utimesSync(dir, past, past);
	}
	events = [];
	await startWatcher();
});

afterEach(async () => {
	await watcher.stop();
	fs.rmSync(root, { recursive: true, force: true });
});

describe("FileWatcher (real chokidar)", () => {
	test("AI side: create then change a file emits add then change", async () => {
		const file = path.join(aiDir, "a.md");
		fs.writeFileSync(file, "one");
		await waitFor(() => has("ai", "add", "a.md"));

		fs.writeFileSync(file, "two, longer");
		await waitFor(() => has("ai", "change", "a.md"));

		const add = events.find((e) => e.type === "add");
		expect(add?.path).toBe(file);
		expect(add?.mapping.id).toBe("m1");
	});

	test("Obsidian side (polling): new note in the vault folder emits add", async () => {
		fs.writeFileSync(path.join(vaultDir, "notes", "b.md"), "note");
		await waitFor(() => has("obsidian", "add", "b.md"));
	});

	test("files in a newly created subdirectory are picked up", async () => {
		fs.mkdirSync(path.join(aiDir, "sub", "deeper"), { recursive: true });
		fs.writeFileSync(path.join(aiDir, "sub", "deeper", "c.md"), "nested");
		await waitFor(() => has("ai", "add", path.join("sub", "deeper", "c.md")));
	});

	test("rename emits add for the new name", async () => {
		const from = path.join(aiDir, "old.md");
		fs.writeFileSync(from, "x");
		await waitFor(() => has("ai", "add", "old.md"));

		fs.renameSync(from, path.join(aiDir, "renamed.md"));
		await waitFor(() => has("ai", "add", "renamed.md"));
	});

	test("deleting a file never reaches sync callbacks (deletions are not synced)", async () => {
		const file = path.join(aiDir, "gone.md");
		fs.writeFileSync(file, "x");
		await waitFor(() => has("ai", "add", "gone.md"));

		fs.unlinkSync(file);
		fs.writeFileSync(path.join(aiDir, "marker.md"), "m");
		await waitFor(() => has("ai", "add", "marker.md"));
		expect(events.some((e) => e.type === "unlink")).toBe(false);
	});

	test("non-synced file types and excluded dirs emit nothing", async () => {
		fs.writeFileSync(path.join(aiDir, "skip.txt"), "x");
		fs.mkdirSync(path.join(aiDir, "node_modules"), { recursive: true });
		fs.writeFileSync(path.join(aiDir, "node_modules", "pkg.md"), "x");
		fs.mkdirSync(path.join(aiDir, ".git"), { recursive: true });
		fs.writeFileSync(path.join(aiDir, ".git", "HEAD.md"), "x");
		// Positive control: a synced file written after the ignored ones arrives,
		// so the absence of the others is not just "nothing has fired yet".
		fs.writeFileSync(path.join(aiDir, "keep.md"), "x");
		await waitFor(() => has("ai", "add", "keep.md"));
		await new Promise((r) => setTimeout(r, 500));

		expect(summary()).toEqual(["ai:add:keep.md"]);
	});
});
