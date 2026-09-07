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
// `process.platform` / `process.env` read becomes `any`.
declare const process: {
  platform: string;
  env: Record<string, string | undefined>;
};
