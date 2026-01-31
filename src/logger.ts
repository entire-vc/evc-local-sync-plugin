import type { App } from "obsidian";
import type { SyncAction } from "./sync-engine";

/**
 * Log entry for a sync operation (FR-030)
 */
export interface LogEntry {
  id: string;
  timestamp: Date;
  direction: "ai-to-obs" | "obs-to-ai";
  mappingId: string;
  mappingName: string;
  file: string;
  action: SyncAction;
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
  direction: "ai-to-obs" | "obs-to-ai";
  mappingId: string;
  mappingName: string;
  file: string;
  action: SyncAction;
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
    this.save().catch((err) => {
      console.error("EVC Sync Logger: Failed to save log", err);
    });

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
    this.save().catch((err) => {
      console.error("EVC Sync Logger: Failed to save log", err);
    });

    return fullEntries;
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
    this.save().catch((err) => {
      console.error("EVC Sync Logger: Failed to save after clear", err);
    });
  }

  /**
   * Clear entries for a specific mapping
   */
  clearByMapping(mappingId: string): void {
    this.entries = this.entries.filter((e) => e.mappingId !== mappingId);
    this.dirty = true;
    this.save().catch((err) => {
      console.error("EVC Sync Logger: Failed to save after clear", err);
    });
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
      const data: StoredLogData = JSON.parse(content);

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
      "direction",
      "mappingId",
      "mappingName",
      "file",
      "action",
      "success",
      "error",
      "details",
    ];

    const rows = this.entries.map((e) => [
      e.id,
      e.timestamp instanceof Date ? e.timestamp.toISOString() : e.timestamp,
      e.direction,
      e.mappingId,
      e.mappingName,
      e.file,
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
