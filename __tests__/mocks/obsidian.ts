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
