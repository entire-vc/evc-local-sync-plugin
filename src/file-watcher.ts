import * as chokidar from "chokidar";
import * as path from "path";
import type { App } from "obsidian";
import type { EVCLocalSyncSettings, ProjectMapping } from "./settings";
import { getVaultBasePath } from "./obsidian-internal";
import { expandHome } from "./path-utils";

/**
 * File change event
 */
export interface FileChangeEvent {
  path: string;
  relativePath: string;
  type: "add" | "change" | "unlink";
  mapping: ProjectMapping;
  source: "ai" | "obsidian";
}

/**
 * File change callback
 */
export type FileChangeCallback = (events: FileChangeEvent[]) => void;

/**
 * File watcher for detecting changes in mapped directories (FR-040)
 *
 * Uses chokidar for robust cross-platform file watching.
 * Implements debouncing to prevent excessive sync operations (NFR-011).
 */
export class FileWatcher {
  private app: App;
  private settings: EVCLocalSyncSettings;
  private callbacks: FileChangeCallback[] = [];
  private watchers: Map<string, chokidar.FSWatcher> = new Map();
  private isWatching = false;
  private pendingEvents: Map<string, FileChangeEvent> = new Map();
  private debounceTimer: number | null = null;

  // Excluded patterns (same as sync-engine)
  // Note: configDir is added dynamically via shouldIgnore method
  private readonly EXCLUDED_DIRS = [
    "node_modules",
    ".git",
    ".DS_Store",
    ".space",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
  ];

  constructor(app: App, settings: EVCLocalSyncSettings) {
    this.app = app;
    this.settings = settings;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: EVCLocalSyncSettings): void {
    const wasWatching = this.isWatching;
    const oldMode = this.settings.syncMode;
    this.settings = settings;

    // Restart watchers if sync mode changed
    if (wasWatching && oldMode !== settings.syncMode) {
      if (settings.syncMode === "on-change") {
        void this.restart();
      } else {
        void this.stop();
      }
    }
  }

  /**
   * Start watching all enabled mappings
   */
  start(): void {
    if (this.isWatching) {
      return;
    }

    const enabledMappings = this.settings.mappings.filter((m) => m.syncEnabled);

    if (enabledMappings.length === 0) {
      return;
    }

    for (const mapping of enabledMappings) {
      this.watchMapping(mapping);
    }

    this.isWatching = true;
  }

  /**
   * Stop watching all mappings
   */
  async stop(): Promise<void> {
    // Clear debounce timer
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Close all watchers
    for (const watcher of this.watchers.values()) {
      await watcher.close();
    }

    this.watchers.clear();
    this.pendingEvents.clear();
    this.isWatching = false;
  }

  /**
   * Restart watchers (e.g., after settings change)
   */
  async restart(): Promise<void> {
    await this.stop();
    this.start();
  }

  /**
   * Watch a single mapping (both AI and Obsidian sides)
   */
  private watchMapping(mapping: ProjectMapping): void {
    // Watch AI project docs folder
    const aiDocsPath = this.getAiDocsPath(mapping);
    this.watchDirectory(aiDocsPath, mapping, "ai");

    // Watch Obsidian docs folder
    const vaultBasePath = getVaultBasePath(this.app);
    const obsDocsPath = this.getObsidianDocsPath(mapping);
    const fullObsDocsPath = path.join(vaultBasePath, obsDocsPath);
    this.watchDirectory(fullObsDocsPath, mapping, "obsidian");
  }

  /**
   * Get full docs path for AI project (same logic as sync-engine).
   * For intra-vault mappings, aiPath is vault-relative so prepend vaultBasePath.
   */
  private getAiDocsPath(mapping: ProjectMapping): string {
    let basePath: string;
    if (mapping.intraVault) {
      basePath = path.join(getVaultBasePath(this.app), mapping.aiPath);
    } else {
      basePath = expandHome(mapping.aiPath);
    }
    if (mapping.docsSubdir && mapping.docsSubdir.trim().length > 0) {
      return path.join(basePath, mapping.docsSubdir);
    }
    return basePath;
  }

  /**
   * Get full docs path for Obsidian (same logic as sync-engine)
   */
  private getObsidianDocsPath(mapping: ProjectMapping): string {
    if (mapping.docsSubdir && mapping.docsSubdir.trim().length > 0) {
      return path.join(mapping.obsidianPath, mapping.docsSubdir);
    }
    return mapping.obsidianPath;
  }

  /**
   * Watch a single directory
   */
  private watchDirectory(
    dirPath: string,
    mapping: ProjectMapping,
    source: "ai" | "obsidian"
  ): void {
    const watcherId = `${mapping.id}-${source}`;

    // Skip if already watching
    if (this.watchers.has(watcherId)) {
      return;
    }

    // Build glob patterns for file types
    const filePatterns = this.settings.fileTypes.map((ext) => `**/*${ext}`);

    try {
      // Use polling for Obsidian vault (Obsidian uses atomic writes)
      const usePolling = source === "obsidian";

      const watcher = chokidar.watch(filePatterns, {
        cwd: dirPath,
        ignored: (filePath: string) => this.shouldIgnore(filePath, dirPath, mapping),
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100,
        },
        // Use polling for Obsidian to detect atomic writes
        usePolling: usePolling,
        interval: usePolling ? 1000 : 100,
        binaryInterval: 2000,
      });

      watcher.on("add", (relativePath) => {
        this.handleFileEvent(relativePath, "add", mapping, source, dirPath);
      });

      watcher.on("change", (relativePath) => {
        this.handleFileEvent(relativePath, "change", mapping, source, dirPath);
      });

      watcher.on("unlink", (relativePath) => {
        // Note: We don't sync deletions by design (NFR-020)
        // Just log for debugging
        console.debug(`EVC Watcher: File removed (not synced): ${relativePath}`);
      });

      watcher.on("error", (error) => {
        console.error(`EVC Watcher: Error watching ${dirPath}:`, error);
      });

      watcher.on("ready", () => {
        console.debug(`EVC Watcher: Ready - watching ${dirPath}`);
      });

      this.watchers.set(watcherId, watcher);
      console.debug(`EVC Watcher: Started watching ${dirPath} for mapping "${mapping.name}" (${source})`);
    } catch (error) {
      console.error(`EVC Watcher: Failed to watch ${dirPath}:`, error);
    }
  }

  /**
   * Handle a file change event with debouncing
   */
  private handleFileEvent(
    relativePath: string,
    type: "add" | "change" | "unlink",
    mapping: ProjectMapping,
    source: "ai" | "obsidian",
    basePath: string
  ): void {
    console.debug(`EVC Watcher: File ${type} detected: ${relativePath} (source: ${source})`);

    const absolutePath = path.join(basePath, relativePath);
    const eventKey = `${mapping.id}:${source}:${relativePath}`;

    const event: FileChangeEvent = {
      path: absolutePath,
      relativePath,
      type,
      mapping,
      source,
    };

    // Add to pending events (overwrites previous event for same file)
    this.pendingEvents.set(eventKey, event);

    // Reset debounce timer
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }

    // Set new debounce timer
    this.debounceTimer = window.setTimeout(() => {
      this.flushPendingEvents();
    }, this.settings.debounceMs);
  }

  /**
   * Flush all pending events to callbacks
   */
  private flushPendingEvents(): void {
    if (this.pendingEvents.size === 0) {
      return;
    }

    const events = Array.from(this.pendingEvents.values());
    this.pendingEvents.clear();

    // Notify all callbacks
    for (const callback of this.callbacks) {
      try {
        callback(events);
      } catch (error) {
        console.error("EVC Watcher: Callback error:", error);
      }
    }
  }

  /**
   * Check if a path should be ignored.
   * @param filePath - path relative to the watched directory (chokidar cwd)
   * @param watchRoot - absolute path of the watched directory (optional)
   * @param mapping - the mapping this watcher belongs to (optional)
   */
  private shouldIgnore(
    filePath: string,
    watchRoot?: string,
    mapping?: ProjectMapping
  ): boolean {
    const parts = filePath.split(path.sep);
    const configDir = this.app.vault.configDir;

    // Check excluded directories
    for (const part of parts) {
      if (this.EXCLUDED_DIRS.includes(part)) {
        return true;
      }
      // Check config directory dynamically
      if (part === configDir) {
        return true;
      }
    }

    // Check user-defined exclusions
    for (const pattern of this.settings.excludePatterns) {
      if (filePath.includes(pattern)) {
        return true;
      }
    }

    // Anti-recursion guard (#14): ignore any immediately-repeated path segment
    // (e.g. ".../docs/docs/...") — the signature of runaway nested-mapping output.
    if (this.hasRepeatedSegment(filePath)) {
      return true;
    }

    // Anti-recursion guard (#14): ignore paths that fall inside ANOTHER enabled
    // mapping's subtree, so synced output is never re-enqueued back through us.
    if (watchRoot && mapping) {
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(watchRoot, filePath);
      for (const root of this.getSiblingRoots(mapping)) {
        if (this.isPathInside(absPath, root)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Absolute AI + Obsidian docs roots of all OTHER enabled mappings.
   */
  private getSiblingRoots(mapping: ProjectMapping): string[] {
    const vaultBasePath = getVaultBasePath(this.app);
    const roots: string[] = [];
    for (const other of this.settings.mappings) {
      if (!other.syncEnabled || other.id === mapping.id) {
        continue;
      }
      roots.push(this.getAiDocsPath(other));
      roots.push(path.join(vaultBasePath, this.getObsidianDocsPath(other)));
    }
    return roots;
  }

  /**
   * Detect an immediately-repeated path segment (e.g. ".../docs/docs/...").
   */
  private hasRepeatedSegment(p: string): boolean {
    const segs = p.replace(/\\/g, "/").split("/").filter((s) => s.length > 0);
    for (let i = 1; i < segs.length; i++) {
      if (segs[i] === segs[i - 1]) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns true if `child` is the same path as, or nested under, `parent`
   * (segment-aware).
   */
  private isPathInside(child: string, parent: string): boolean {
    const norm = (p: string): string =>
      p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
    const c = norm(child);
    const par = norm(parent);
    return c === par || c.startsWith(par + "/");
  }

  /**
   * Register a callback for file changes
   */
  onFileChange(callback: FileChangeCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Remove a callback
   */
  offFileChange(callback: FileChangeCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * Check if watcher is active
   */
  isActive(): boolean {
    return this.isWatching;
  }

  /**
   * Get count of active watchers
   */
  getWatcherCount(): number {
    return this.watchers.size;
  }
}
