import { Notice, type App } from "obsidian";
import type { SyncAction } from "./sync-engine";

/**
 * What triggered a sync cycle. Threaded through to every log entry that cycle
 * produces, plus the standalone "cycle-start" marker entry (see logCycleStart) —
 * without it, a run that copied zero files (nothing had changed) leaves NO trace
 * that it ran at all, which is exactly what made the startup cycle unreadable on
 * a live measurement (#94002fd9): files were demonstrably written, but nothing in
 * sync-log.json distinguished "this came from startup" from any other trigger,
 * and a fully-uneventful startup run left no entry whatsoever.
 */
export type SyncTriggerMode = "startup" | "manual" | "scheduled" | "on-change";

/**
 * Log entry for a sync operation (FR-030), OR a cycle-start marker.
 *
 * Two shapes share this one type rather than a discriminated union so the
 * flat on-disk array and the existing per-file consumers (log-viewer-modal,
 * CSV/JSON export) don't need a schema migration — a cycle-start entry simply
 * leaves the per-file fields (direction/mappingId/mappingName/file) unset and
 * carries `mappingNames` instead. `action: "cycle-start"` is what tells them apart.
 */
export interface LogEntry {
  id: string;
  timestamp: Date;
  /** Present on every entry once a caller passes a mode through log()/logCycleStart(). */
  mode?: SyncTriggerMode;
  direction?: "ai-to-obs" | "obs-to-ai";
  mappingId?: string;
  mappingName?: string;
  /** cycle-start only: every mapping the cycle attempted, not just the ones with changes. */
  mappingNames?: string[];
  file?: string;
  /**
   * Fully-resolved destination path the file was actually written to/read from —
   * distinct from `file` (which is only the relative path within whichever root)
   * so the log can tell a write into `docs/` apart from one into `docs/dev-docs/`
   * when a mapping's docsSubdir folds them to look identical relatively (#94002fd9).
   */
  targetPath?: string;
  action: SyncAction | "cycle-start";
  success: boolean;
  error?: string;
  details?: string;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  maxEntries: number;
  retentionDays: number;
}

/**
 * Default logger configuration
 */
export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  maxEntries: 1000,
  retentionDays: 7,
};

/**
 * Stored log data structure
 */
interface StoredLogData {
  version: string;
  entries: SerializedLogEntry[];
}

/**
 * Serialized log entry for storage (Date as string)
 */
interface SerializedLogEntry {
  id: string;
  timestamp: string;
  mode?: SyncTriggerMode;
  direction?: "ai-to-obs" | "obs-to-ai";
  mappingId?: string;
  mappingName?: string;
  mappingNames?: string[];
  file?: string;
  targetPath?: string;
  action: SyncAction | "cycle-start";
  success: boolean;
  error?: string;
  details?: string;
}

/**
 * Log file path within plugin data folder
 */
const LOG_FILE_NAME = "sync-log.json";

/**
 * Generate unique ID for log entries
 */
function generateLogId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

/**
 * Logger for sync operations (FR-030, FR-032)
 *
 * Features:
 * - Logs sync operations with timestamp, direction, file, action
 * - Log rotation: removes entries older than retentionDays or > maxEntries
 * - Persistence: saves to .obsidian/plugins/evc-local-sync/sync-log.json
 */
export class SyncLogger {
  private app: App;
  private config: LoggerConfig;
  private entries: LogEntry[] = [];
  private dirty = false;

  constructor(app: App, config: LoggerConfig = DEFAULT_LOGGER_CONFIG) {
    this.app = app;
    this.config = config;
  }

  /**
   * Update logger configuration
   */
  setConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Log a sync operation
   */
  log(entry: Omit<LogEntry, "id" | "timestamp">): LogEntry {
    const fullEntry: LogEntry = {
      ...entry,
      id: generateLogId(),
      timestamp: new Date(),
    };

    this.entries.push(fullEntry);
    this.dirty = true;

    // Apply rotation if needed
    this.rotate();

    // Auto-save (debounced in practice, but for now immediate)
    this.autosave("log a sync operation");

    return fullEntry;
  }

  /**
   * Log multiple entries at once (for batch sync results)
   */
  logBatch(entries: Omit<LogEntry, "id" | "timestamp">[]): LogEntry[] {
    const fullEntries: LogEntry[] = entries.map((entry) => ({
      ...entry,
      id: generateLogId(),
      timestamp: new Date(),
    }));

    this.entries.push(...fullEntries);
    this.dirty = true;

    // Apply rotation if needed
    this.rotate();

    // Auto-save
    this.autosave("log a batch of sync operations");

    return fullEntries;
  }

  /**
   * Record that a sync CYCLE started — independent of whether any file ends up
   * copied. Without this, a cycle that finds nothing to do (everything already
   * in sync) leaves zero entries, and the log can no longer distinguish "ran,
   * nothing changed" from "never ran" — exactly the gap that made the startup
   * cycle unreadable on a live measurement (#94002fd9, mode=startup writes were
   * demonstrably happening while sync-log.json's mtime never moved). Call this
   * BEFORE the sync runs, once per cycle, regardless of outcome; per-file
   * entries from the same cycle should carry the same `mode` so both can be
   * correlated by time + mode.
   */
  logCycleStart(mode: SyncTriggerMode, mappings: { id: string; name: string }[]): LogEntry {
    const fullEntry: LogEntry = {
      id: generateLogId(),
      timestamp: new Date(),
      mode,
      mappingNames: mappings.map((m) => m.name),
      action: "cycle-start",
      success: true,
    };

    this.entries.push(fullEntry);
    this.dirty = true;
    this.rotate();
    this.autosave("record a cycle start");

    return fullEntry;
  }

  /**
   * Persist immediately, and if it fails, surface a VISIBLE warning rather than
   * only a console line (#94002fd9 acceptance: a swallowed write failure is
   * indistinguishable from "nothing happened" to whoever reads sync-log.json
   * later — the whole point of this file existing). Never throws: a failed log
   * write must not take the sync itself down.
   */
  private autosave(context: string): void {
    this.save().catch((err) => {
      console.error(`EVC Sync Logger: failed to ${context} — sync-log.json was NOT updated`, err);
      new Notice(
        `EVC Sync: could not write sync-log.json (${context}). The sync itself is unaffected, ` +
          "but this run will be invisible in the log — see the developer console for details.",
        10000
      );
    });
  }

  /**
   * Get all log entries
   */
  getAll(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries for a specific mapping
   */
  getByMapping(mappingId: string): LogEntry[] {
    return this.entries.filter((e) => e.mappingId === mappingId);
  }

  /**
   * Get recent entries (last N)
   */
  getRecent(count: number): LogEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * Get entries within a date range
   */
  getByDateRange(startDate: Date, endDate: Date): LogEntry[] {
    return this.entries.filter((e) => {
      const entryTime = e.timestamp.getTime();
      return entryTime >= startDate.getTime() && entryTime <= endDate.getTime();
    });
  }

  /**
   * Get entries by action type
   */
  getByAction(action: SyncAction): LogEntry[] {
    return this.entries.filter((e) => e.action === action);
  }

  /**
   * Get failed entries
   */
  getFailed(): LogEntry[] {
    return this.entries.filter((e) => !e.success);
  }

  /**
   * Get successful entries
   */
  getSuccessful(): LogEntry[] {
    return this.entries.filter((e) => e.success);
  }

  /**
   * Get statistics for a mapping
   */
  getStats(mappingId?: string): {
    total: number;
    successful: number;
    failed: number;
    copies: number;
    updates: number;
    skips: number;
    conflicts: number;
  } {
    const filtered = mappingId
      ? this.entries.filter((e) => e.mappingId === mappingId)
      : this.entries;

    return {
      total: filtered.length,
      successful: filtered.filter((e) => e.success).length,
      failed: filtered.filter((e) => !e.success).length,
      copies: filtered.filter((e) => e.action === "copy").length,
      updates: filtered.filter((e) => e.action === "update").length,
      skips: filtered.filter((e) => e.action === "skip").length,
      conflicts: filtered.filter((e) => e.action === "conflict").length,
    };
  }

  /**
   * Get total count
   */
  getCount(): number {
    return this.entries.length;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
    this.dirty = true;
    this.autosave("save after clear");
  }

  /**
   * Clear entries for a specific mapping
   */
  clearByMapping(mappingId: string): void {
    this.entries = this.entries.filter((e) => e.mappingId !== mappingId);
    this.dirty = true;
    this.autosave("save after clear");
  }

  /**
   * Apply log rotation (FR-032)
   * Remove entries older than retentionDays or if count > maxEntries
   */
  rotate(): void {
    const now = Date.now();
    const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = now - retentionMs;

    // Remove old entries
    const beforeCount = this.entries.length;
    this.entries = this.entries.filter((e) => {
      const entryTime = e.timestamp instanceof Date
        ? e.timestamp.getTime()
        : new Date(e.timestamp).getTime();
      return entryTime >= cutoffTime;
    });

    // Trim to max entries (keep most recent)
    if (this.entries.length > this.config.maxEntries) {
      this.entries = this.entries.slice(-this.config.maxEntries);
    }

    if (this.entries.length !== beforeCount) {
      this.dirty = true;
    }
  }

  /**
   * Load entries from storage
   */
  async load(): Promise<void> {
    try {
      const pluginDir = this.getPluginDataDir();
      const logFilePath = `${pluginDir}/${LOG_FILE_NAME}`;

      // Check if file exists
      const exists = await this.app.vault.adapter.exists(logFilePath);
      if (!exists) {
        this.entries = [];
        return;
      }

      // Read file
      const content = await this.app.vault.adapter.read(logFilePath);
      const data = JSON.parse(content) as StoredLogData;

      // Deserialize entries (convert timestamp strings to Date objects)
      this.entries = data.entries.map((e) => ({
        ...e,
        timestamp: new Date(e.timestamp),
      }));

      // Apply rotation after loading
      this.rotate();

      console.debug(`EVC Sync Logger: Loaded ${this.entries.length} log entries`);
    } catch (error) {
      console.warn("EVC Sync Logger: Failed to load logs, starting fresh", error);
      this.entries = [];
    }
  }

  /**
   * Save entries to storage
   */
  async save(): Promise<void> {
    if (!this.dirty) {
      return;
    }

    try {
      const pluginDir = this.getPluginDataDir();
      const logFilePath = `${pluginDir}/${LOG_FILE_NAME}`;

      // Ensure plugin directory exists
      const dirExists = await this.app.vault.adapter.exists(pluginDir);
      if (!dirExists) {
        await this.app.vault.adapter.mkdir(pluginDir);
      }

      // Serialize entries (convert Date objects to ISO strings)
      const serializedEntries: SerializedLogEntry[] = this.entries.map((e) => ({
        ...e,
        timestamp: e.timestamp instanceof Date
          ? e.timestamp.toISOString()
          : e.timestamp,
      }));

      const data: StoredLogData = {
        version: "1.0",
        entries: serializedEntries,
      };

      // Write file
      await this.app.vault.adapter.write(
        logFilePath,
        JSON.stringify(data, null, 2)
      );

      this.dirty = false;
    } catch (error) {
      console.error("EVC Sync Logger: Failed to save logs", error);
      throw error;
    }
  }

  /**
   * Get plugin data directory path
   */
  private getPluginDataDir(): string {
    return `${this.app.vault.configDir}/plugins/evc-local-sync`;
  }

  /**
   * Export logs as JSON string
   */
  exportAsJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * Export logs as CSV string
   */
  exportAsCsv(): string {
    const headers = [
      "id",
      "timestamp",
      "mode",
      "direction",
      "mappingId",
      "mappingName",
      "file",
      "targetPath",
      "action",
      "success",
      "error",
      "details",
    ];

    // cycle-start entries carry no direction/mappingId/file — `?? ""` keeps those
    // columns blank instead of the literal string "undefined" (String(undefined)).
    const rows = this.entries.map((e) => [
      e.id,
      e.timestamp instanceof Date ? e.timestamp.toISOString() : e.timestamp,
      e.mode ?? "",
      e.direction ?? "",
      e.mappingId ?? "",
      e.mappingName ?? (e.mappingNames ? e.mappingNames.join("; ") : ""),
      e.file ?? "",
      e.targetPath ?? "",
      e.action,
      String(e.success),
      e.error || "",
      e.details || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    return csvContent;
  }
}
