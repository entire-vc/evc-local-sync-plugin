import * as chokidar from "chokidar";
import * as path from "path";
import type { App } from "obsidian";
import type { EVCLocalSyncSettings, ProjectMapping } from "./settings";

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
  private debounceTimer: NodeJS.Timeout | null = null;

  // Excluded patterns (same as sync-engine)
  private readonly EXCLUDED_DIRS = [
    "node_modules",
    ".git",
    ".obsidian",
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
        this.restart();
      } else {
        this.stop();
      }
    }
  }

  /**
   * Start watching all enabled mappings
   */
  async start(): Promise<void> {
    if (this.isWatching) {
      return;
    }

    const enabledMappings = this.settings.mappings.filter((m) => m.syncEnabled);

    if (enabledMappings.length === 0) {
      return;
    }

    for (const mapping of enabledMappings) {
      await this.watchMapping(mapping);
    }

    this.isWatching = true;
  }

  /**
   * Stop watching all mappings
   */
  async stop(): Promise<void> {
    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Close all watchers
    for (const [id, watcher] of this.watchers) {
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
    await this.start();
  }

  /**
   * Watch a single mapping (both AI and Obsidian sides)
   */
  private async watchMapping(mapping: ProjectMapping): Promise<void> {
    // Watch AI project docs folder
    const aiDocsPath = this.getAiDocsPath(mapping);
    await this.watchDirectory(aiDocsPath, mapping, "ai");

    // Watch Obsidian docs folder
    const vaultBasePath = (this.app.vault.adapter as any).basePath || "";
    const obsDocsPath = this.getObsidianDocsPath(mapping);
    const fullObsDocsPath = path.join(vaultBasePath, obsDocsPath);
    await this.watchDirectory(fullObsDocsPath, mapping, "obsidian");
  }

  /**
   * Get full docs path for AI project (same logic as sync-engine)
   */
  private getAiDocsPath(mapping: ProjectMapping): string {
    const basePath = mapping.aiPath.replace(/^~/, process.env.HOME || "");
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
  private async watchDirectory(
    dirPath: string,
    mapping: ProjectMapping,
    source: "ai" | "obsidian"
  ): Promise<void> {
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
        ignored: (filePath: string) => this.shouldIgnore(filePath),
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
        console.log(`EVC Watcher: Ready - watching ${dirPath}`);
      });

      this.watchers.set(watcherId, watcher);
      console.log(`EVC Watcher: Started watching ${dirPath} for mapping "${mapping.name}" (${source})`);
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
    console.log(`EVC Watcher: File ${type} detected: ${relativePath} (source: ${source})`);

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
      clearTimeout(this.debounceTimer);
    }

    // Set new debounce timer
    this.debounceTimer = setTimeout(() => {
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
   * Check if a path should be ignored
   */
  private shouldIgnore(filePath: string): boolean {
    const parts = filePath.split(path.sep);

    // Check excluded directories
    for (const part of parts) {
      if (this.EXCLUDED_DIRS.includes(part)) {
        return true;
      }
    }

    // Check user-defined exclusions
    for (const pattern of this.settings.excludePatterns) {
      if (filePath.includes(pattern)) {
        return true;
      }
    }

    return false;
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
