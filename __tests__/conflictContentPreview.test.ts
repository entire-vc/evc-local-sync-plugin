/**
 * Unit tests for getConflictContentPreview (task ea2cbb1a / audit #26edb457).
 *
 * The conflict dialog used to show only mtime/size/path — a user could not tell
 * two conflicting files apart without leaving the dialog to open them. These tests
 * cover the pure read/classify logic in isolation from the Modal/DOM rendering,
 * which is not unit-testable under this repo's node-environment Jest setup (no
 * Obsidian Modal/createEl mock exists) — that side is verified visually per §1k.
 */

import { describe, test, expect, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
	getConflictContentPreview,
	CONFLICT_PREVIEW_MAX_CHARS,
	CONFLICT_PREVIEW_MAX_READ_BYTES,
} from "../src/conflict-content-preview";

function tmpFile(content: string | Buffer, name = "note.md"): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evc-ls-conflict-preview-"));
	const p = path.join(dir, name);
	fs.writeFileSync(p, content);
	return p;
}

const cleanupDirs: string[] = [];

afterEach(() => {
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
	}
});

function trackedTmpFile(content: string | Buffer, name = "note.md"): string {
	const p = tmpFile(content, name);
	cleanupDirs.push(path.dirname(p));
	return p;
}

describe("getConflictContentPreview", () => {
	test("returns full text for a short file — the actual audit repro (12/15 bytes)", () => {
		const aiFile = trackedTmpFile("ai version\n");
		const obsFile = trackedTmpFile("obsidian text\n");

		const aiPreview = getConflictContentPreview(aiFile);
		const obsPreview = getConflictContentPreview(obsFile);

		expect(aiPreview).toEqual({
			status: "ok",
			text: "ai version\n",
			truncated: false,
			totalLength: 11,
		});
		expect(obsPreview.status).toBe("ok");
		expect(obsPreview.text).toBe("obsidian text\n");
		// The whole point of the fix: two conflicting versions must read as different text.
		expect(aiPreview.text).not.toBe(obsPreview.text);
	});

	test("truncates long text and reports the real total length", () => {
		const long = "x".repeat(CONFLICT_PREVIEW_MAX_CHARS + 500);
		const file = trackedTmpFile(long);

		const preview = getConflictContentPreview(file);

		expect(preview.status).toBe("ok");
		expect(preview.truncated).toBe(true);
		expect(preview.text?.length).toBe(CONFLICT_PREVIEW_MAX_CHARS);
		expect(preview.totalLength).toBe(long.length);
	});

	test("does not truncate a file exactly at the cap", () => {
		const exact = "y".repeat(CONFLICT_PREVIEW_MAX_CHARS);
		const file = trackedTmpFile(exact);

		const preview = getConflictContentPreview(file);

		expect(preview.truncated).toBe(false);
		expect(preview.text).toBe(exact);
	});

	test("classifies a file containing a null byte as binary, not garbled text", () => {
		const file = trackedTmpFile(Buffer.from([0x50, 0x4b, 0x00, 0x03, 0x04]), "image.png");

		const preview = getConflictContentPreview(file);

		expect(preview.status).toBe("binary");
		expect(preview.text).toBeNull();
	});

	test("classifies invalid-UTF-8 bytes (replacement char) as binary", () => {
		// 0xFF is not valid UTF-8 anywhere — Node's utf-8 decode replaces it with U+FFFD.
		const file = trackedTmpFile(Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02]), "data.bin");

		const preview = getConflictContentPreview(file);

		expect(preview.status).toBe("binary");
		expect(preview.text).toBeNull();
	});

	test("skips reading (does not hang) a file above the size cap, still reports its size", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evc-ls-conflict-preview-"));
		cleanupDirs.push(dir);
		const file = path.join(dir, "huge.md");
		const size = CONFLICT_PREVIEW_MAX_READ_BYTES + 1;
		// Sparse-ish allocation via truncate — no need to actually write real bytes for a size check.
		const fd = fs.openSync(file, "w");
		fs.ftruncateSync(fd, size);
		fs.closeSync(fd);

		const preview = getConflictContentPreview(file);

		expect(preview.status).toBe("too-large");
		expect(preview.text).toBeNull();
		expect(preview.totalLength).toBe(size);
	});

	test("reports unreadable for a missing file instead of throwing", () => {
		const preview = getConflictContentPreview("/nonexistent/path/does-not-exist.md");

		expect(preview.status).toBe("unreadable");
		expect(preview.text).toBeNull();
		expect(preview.totalLength).toBe(0);
	});
});
