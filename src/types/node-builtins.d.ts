// Ambient declarations for the small subset of Node built-ins Local Sync uses.
//
// The Obsidian catalog scanner lints this repository WITHOUT resolving @types/node
// (measured: it resolves `obsidian` but not the Node type package, in any dependency
// section). Without types, every `fs.*` / `path.*` value is `any`, and the scan reports
// ~351 no-unsafe-* warnings. These declarations travel WITH the source, so the scanner
// sees them; @types/node stays for local dev and is unaffected.

declare module "fs" {
  export interface Stats {
    size: number;
    mtime: Date;
    mtimeMs: number;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }
  export function existsSync(p: string): boolean;
  export function mkdirSync(p: string, o?: { recursive?: boolean }): string | undefined;
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }
  export function readdirSync(p: string): string[];
  export function readdirSync(p: string, o: { withFileTypes: true }): Dirent[];
  export function readFileSync(p: string, e: string): string;
  export function realpathSync(p: string): string;
  export function statSync(p: string): Stats;
  export function unlinkSync(p: string): void;
  export function utimesSync(p: string, a: Date | number, m: Date | number): void;
  export function writeFileSync(p: string, d: string, e?: string): void;
}

declare module "fs/promises" {
  export function access(p: string, mode?: number): Promise<void>;
  export function readFile(p: string, e: string): Promise<string>;
  export function writeFile(p: string, d: string, e?: string): Promise<void>;
}

// chokidar's own .d.ts imports `Stats` from "node:fs" (not "fs") and `EventEmitter`
// from "node:events" — both unresolved specifiers on top of the ones above, since we
// only declared the bare "fs"/"path"/"crypto" names. `skipLibCheck` hides the fallout
// inside chokidar's .d.ts itself, but `FSWatcher.on(...)` still resolves through it to
// `any` at every call site in file-watcher.ts, which is where the warnings surface.
declare module "node:fs" {
  export * from "fs";
}

declare module "node:events" {
  // Mirrors the real @types/node generic EventEmitter closely enough for chokidar's
  // `class FSWatcher extends EventEmitter<FSWatcherEventMap>` to type `.on()` per-event
  // instead of falling back to `any`.
  export class EventEmitter<Events extends Record<string, unknown[]> = Record<string, unknown[]>> {
    on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this;
    once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this;
    off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this;
    emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean;
    removeAllListeners(event?: keyof Events): this;
  }
}

// sync-state-manager.ts narrows a caught error via `NodeJS.ErrnoException`.
declare namespace NodeJS {
  interface ErrnoException extends Error {
    code?: string;
    errno?: number;
    syscall?: string;
    path?: string;
  }
}

declare module "path" {
  export const sep: string;
  export function basename(p: string, ext?: string): string;
  export function dirname(p: string): string;
  export function extname(p: string): string;
  export function isAbsolute(p: string): boolean;
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}

declare module "crypto" {
  export interface Hash {
    update(data: string): Hash;
    digest(enc: string): string;
  }
  export function createHash(alg: string): Hash;
}

// `process` is a Node global; without @types/node it is unresolved and every
// `process.platform` read, or access to its `env` property, becomes `any`.
declare const process: {
  platform: string;
  env: Record<string, string | undefined>;
};
