/**
 * Minimal Obsidian API mock for Jest tests.
 *
 * Only implements the subset used by SyncEngine and its helpers.
 * Real fs operations are delegated to the test harness via the mocked vault.
 */

export function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

export class TAbstractFile {
	constructor(public path: string) {}
	get name(): string {
		return this.path.split("/").pop() ?? this.path;
	}
}

export class TFile extends TAbstractFile {
	extension: string;
	stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };
	basename: string;
	parent: TFolder | null = null;

	constructor(path: string) {
		super(path);
		const parts = path.split(".");
		this.extension = parts.length > 1 ? parts[parts.length - 1] : "";
		this.basename = this.name.replace(/\.[^.]+$/, "");
	}
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot(): boolean {
		return this.path === "/";
	}
}

/**
 * SyncLogger (and log-viewer-modal) construct `new Notice(...)` on save
 * failures / UI clicks — a real Notice pops a toast in the Obsidian UI, which
 * doesn't exist under Jest. This just needs to be constructible without
 * throwing; tests that care about a warning being shown spy on this instead.
 */
export class Notice {
	constructor(_message: string, _timeout?: number) {}
}

/**
 * Minimal DOM-less stand-in for the HTMLElement Obsidian hands modals via
 * `contentEl` (`createEl`/`createDiv`/`addClass`/`empty`). `testEnvironment:
 * "node"` in jest.config.js means there is no real `document` — this covers
 * only what confirmation-modal.ts (and similar modals) actually call.
 * `click()` lets a test simulate a button press; `close()`/`open()` on
 * `MockModal` below simulate Obsidian's own Esc/backdrop path, which calls
 * `onClose()` directly without going through any button's click handler.
 */
export class MockEl {
	tagName: string;
	text?: string;
	cls: string[] = [];
	children: MockEl[] = [];
	private listeners: Record<string, Array<() => void>> = {};

	constructor(tagName = "div") {
		this.tagName = tagName;
	}

	empty(): void {
		this.children = [];
	}

	addClass(...classes: string[]): void {
		this.cls.push(...classes);
	}

	createEl(tag: string, opts?: { text?: string; cls?: string }): MockEl {
		const el = new MockEl(tag);
		if (opts?.text) el.text = opts.text;
		if (opts?.cls) el.cls.push(...opts.cls.split(" "));
		this.children.push(el);
		return el;
	}

	createDiv(opts?: { cls?: string }): MockEl {
		return this.createEl("div", opts);
	}

	addEventListener(event: string, handler: () => void): void {
		(this.listeners[event] ??= []).push(handler);
	}

	click(): void {
		for (const handler of this.listeners["click"] ?? []) handler();
	}
}

export class Modal {
	app: App;
	contentEl: MockEl = new MockEl("div");

	constructor(app: App) {
		this.app = app;
	}

	open(): void {
		this.onOpen();
	}

	// Obsidian calls onClose() for EVERY dismissal path — explicit close(),
	// Esc, and backdrop click all converge here. A test simulates Esc/backdrop
	// by calling close() directly, without first triggering a button's click.
	close(): void {
		this.onClose();
	}

	onOpen(): void {}
	onClose(): void {}
}

export class App {
	vault: ReturnType<typeof makeVaultMock>;
	constructor(vault: ReturnType<typeof makeVaultMock>) {
		this.vault = vault;
	}
}

export function makeVaultMock(vaultBasePath: string) {
	const fs = require("fs") as typeof import("fs");
	const path = require("path") as typeof import("path");
	const nodePath = path;

	return {
		configDir: ".obsidian",

		getRoot(): TFolder {
			const root = new TFolder("/");
			try {
				for (const entry of fs.readdirSync(vaultBasePath)) {
					const entryPath = path.join(vaultBasePath, entry);
					const stat = fs.statSync(entryPath);
					if (stat.isDirectory()) {
						root.children.push(new TFolder(entry));
					} else {
						root.children.push(new TFile(entry));
					}
				}
			} catch {
				// vault dir may not exist yet
			}
			return root;
		},

		getAbstractFileByPath(vaultRelPath: string): TAbstractFile | null {
			const abs = path.join(vaultBasePath, vaultRelPath);
			if (!fs.existsSync(abs)) return null;
			const stat = fs.statSync(abs);
			if (stat.isDirectory()) {
				const folder = new TFolder(vaultRelPath);
				for (const entry of fs.readdirSync(abs)) {
					const childRel = vaultRelPath + "/" + entry;
					const childAbs = path.join(abs, entry);
					const childStat = fs.statSync(childAbs);
					if (childStat.isDirectory()) {
						folder.children.push(new TFolder(childRel));
					} else {
						const f = new TFile(childRel);
						f.stat.mtime = childStat.mtimeMs;
						f.stat.size = childStat.size;
						folder.children.push(f);
					}
				}
				return folder;
			}
			const f = new TFile(vaultRelPath);
			f.stat.mtime = stat.mtimeMs;
			f.stat.size = stat.size;
			return f;
		},

		async create(vaultRelPath: string, content: string): Promise<TFile> {
			const abs = path.join(vaultBasePath, vaultRelPath);
			fs.mkdirSync(path.dirname(abs), { recursive: true });
			fs.writeFileSync(abs, content, "utf-8");
			return new TFile(vaultRelPath);
		},

		async createFolder(vaultRelPath: string): Promise<TFolder> {
			const abs = path.join(vaultBasePath, vaultRelPath);
			fs.mkdirSync(abs, { recursive: true });
			return new TFolder(vaultRelPath);
		},

		async modify(_file: TFile, content: string): Promise<void> {
			const abs = path.join(vaultBasePath, _file.path);
			fs.mkdirSync(path.dirname(abs), { recursive: true });
			fs.writeFileSync(abs, content, "utf-8");
		},

		async read(file: TFile): Promise<string> {
			const abs = path.join(vaultBasePath, file.path);
			return fs.readFileSync(abs, "utf-8");
		},

		async readBinary(file: TFile): Promise<ArrayBuffer> {
			const abs = path.join(vaultBasePath, file.path);
			const buf = fs.readFileSync(abs);
			return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		},

		adapter: {
			basePath: vaultBasePath,

			async stat(vaultRelPath: string) {
				const abs = path.join(vaultBasePath, vaultRelPath);
				if (!fs.existsSync(abs)) return null;
				const s = fs.statSync(abs);
				return { mtime: s.mtimeMs, ctime: s.ctimeMs, size: s.size };
			},
			async mkdir(vaultRelPath: string): Promise<void> {
				const abs = path.join(vaultBasePath, vaultRelPath);
				fs.mkdirSync(abs, { recursive: true });
			},
			async write(vaultRelPath: string, content: string): Promise<void> {
				const abs = path.join(vaultBasePath, vaultRelPath);
				fs.mkdirSync(path.dirname(abs), { recursive: true });
				fs.writeFileSync(abs, content, "utf-8");
			},
			exists(vaultRelPath: string): Promise<boolean> {
				const abs = path.join(vaultBasePath, vaultRelPath);
				return Promise.resolve(fs.existsSync(abs));
			},
		},
	};
}
