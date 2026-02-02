import type { App } from "obsidian";
import type { ProjectMapping, EVCLocalSyncSettings, ConflictResolution } from "./settings";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/**
 * State of a single file at last sync
 */
export interface SyncFileState {
  /** Relative path within docs folder */
  path: string;
  /** File content hash (MD5) for change detection */
  hash: string;
  /** Last modified time (mtime) in ms */
  mtime: number;
  /** File size in bytes */
  size: number;
}

/**
 * Sync state for a single mapping
 */
export interface MappingSyncState {
  /** Mapping ID this state belongs to */
  mappingId: string;
  /** Timestamp of last successful sync */
  lastSyncTime: number;
  /** State of files in AI project at last sync */
  aiFiles: SyncFileState[];
  /** State of files in Obsidian at last sync */
  obsFiles: SyncFileState[];
  /** Schema version for migrations */
  version: number;
}

/**
 * Store for all sync states
 */
export interface SyncStateStore {
  /** Map of mappingId -> MappingSyncState */
  mappings: Record<string, MappingSyncState>;
  /** Global schema version */
  version: number;
}

/**
 * Detected deletion
 */
export interface DetectedDeletion {
  /** Relative path of deleted file */
  relativePath: string;
  /** Where the file was deleted from */
  deletedFrom: "ai" | "obsidian";
  /** Where it still exists (and should be deleted) */
  existsIn: "ai" | "obsidian";
  /** Full path to the file that should be deleted */
  targetPath: string;
  /** Last known state of the deleted file */
  lastState: SyncFileState;
}

const SYNC_STATE_FILE = "sync-state.json";
const CURRENT_VERSION = 1;

/**
 * Manages sync state persistence for file deletion tracking (FR-060)
 */
export class SyncStateManager {
  private app: App;
  private store: SyncStateStore;
  private pluginDir: string;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.pluginDir = pluginDir;
    this.store = {
      mappings: {},
      version: CURRENT_VERSION,
    };
  }

  /**
   * Load state from disk
   */
  async load(): Promise<void> {
    const statePath = path.join(this.pluginDir, SYNC_STATE_FILE);

    try {
      if (fs.existsSync(statePath)) {
        const content = fs.readFileSync(statePath, "utf-8");
        const data = JSON.parse(content) as SyncStateStore;

        // Validate version
        if (data.version && data.version <= CURRENT_VERSION) {
          this.store = data;
        } else {
          // Future version, reset to empty
          console.warn("EVC Sync: sync-state.json has newer version, resetting");
          this.store = { mappings: {}, version: CURRENT_VERSION };
        }
      }
    } catch (error) {
      console.error("EVC Sync: Failed to load sync state:", error);
      // Start fresh on error
      this.store = { mappings: {}, version: CURRENT_VERSION };
    }
  }

  /**
   * Save state to disk
   */
  async save(): Promise<void> {
    const statePath = path.join(this.pluginDir, SYNC_STATE_FILE);

    try {
      const content = JSON.stringify(this.store, null, 2);
      fs.writeFileSync(statePath, content, "utf-8");
    } catch (error) {
      console.error("EVC Sync: Failed to save sync state:", error);
    }
  }

  /**
   * Get state for a mapping (or null if first sync)
   */
  getState(mappingId: string): MappingSyncState | null {
    return this.store.mappings[mappingId] || null;
  }

  /**
   * Check if this is the first sync for a mapping
   */
  isFirstSync(mappingId: string): boolean {
    return !this.store.mappings[mappingId];
  }

  /**
   * Update state after successful sync
   */
  updateState(
    mappingId: string,
    aiFiles: SyncFileState[],
    obsFiles: SyncFileState[]
  ): void {
    this.store.mappings[mappingId] = {
      mappingId,
      lastSyncTime: Date.now(),
      aiFiles,
      obsFiles,
      version: CURRENT_VERSION,
    };
  }

  /**
   * Clear state for a mapping (e.g., on mapping delete)
   */
  clearState(mappingId: string): void {
    delete this.store.mappings[mappingId];
  }

  /**
   * Detect deleted files by comparing current state with last sync state
   */
  detectDeletions(
    mappingId: string,
    currentAiFiles: Map<string, { absolutePath: string }>,
    currentObsFiles: Map<string, { absolutePath: string }>,
    aiDocsPath: string,
    obsDocsPath: string,
    bidirectional: boolean
  ): DetectedDeletion[] {
    const deletions: DetectedDeletion[] = [];
    const previousState = this.getState(mappingId);

    // No previous state = first sync, no deletions
    if (!previousState) {
      return deletions;
    }

    // Check for files deleted in AI project
    for (const prevFile of previousState.aiFiles) {
      if (!currentAiFiles.has(prevFile.path)) {
        // File was deleted in AI
        const obsFile = currentObsFiles.get(prevFile.path);
        if (obsFile) {
          // File still exists in Obsidian - should be deleted
          deletions.push({
            relativePath: prevFile.path,
            deletedFrom: "ai",
            existsIn: "obsidian",
            targetPath: obsFile.absolutePath,
            lastState: prevFile,
          });
        }
      }
    }

    // Check for files deleted in Obsidian (only if bidirectional)
    if (bidirectional) {
      for (const prevFile of previousState.obsFiles) {
        if (!currentObsFiles.has(prevFile.path)) {
          // File was deleted in Obsidian
          const aiFile = currentAiFiles.get(prevFile.path);
          if (aiFile) {
            // File still exists in AI - should be deleted
            deletions.push({
              relativePath: prevFile.path,
              deletedFrom: "obsidian",
              existsIn: "ai",
              targetPath: aiFile.absolutePath,
              lastState: prevFile,
            });
          }
        }
      }
    }

    return deletions;
  }

  /**
   * Calculate MD5 hash of file content
   */
  static async hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const hash = crypto.createHash("md5").update(content).digest("hex");
        resolve(hash);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Build file state from current files
   */
  async buildFileState(
    files: Array<{ relativePath: string; absolutePath: string; mtime: number; size: number }>
  ): Promise<SyncFileState[]> {
    const states: SyncFileState[] = [];

    for (const file of files) {
      try {
        const hash = await SyncStateManager.hashFile(file.absolutePath);
        states.push({
          path: file.relativePath,
          hash,
          mtime: file.mtime,
          size: file.size,
        });
      } catch {
        // Skip files we can't hash
      }
    }

    return states;
  }
}

// ============ Helper functions for per-mapping settings (FR-061, FR-062) ============

/**
 * Get effective conflict resolution strategy for a mapping
 */
export function getEffectiveConflictResolution(
  mapping: ProjectMapping,
  globalSettings: EVCLocalSyncSettings
): ConflictResolution {
  return mapping.conflictResolutionOverride ?? globalSettings.conflictResolution;
}

/**
 * Get effective file types for a mapping
 */
export function getEffectiveFileTypes(
  mapping: ProjectMapping,
  globalSettings: EVCLocalSyncSettings
): string[] {
  return mapping.fileTypesOverride ?? globalSettings.fileTypes;
}

/**
 * Get effective exclude patterns for a mapping
 */
export function getEffectiveExcludePatterns(
  mapping: ProjectMapping,
  globalSettings: EVCLocalSyncSettings
): string[] {
  return mapping.excludePatternsOverride ?? globalSettings.excludePatterns;
}

/**
 * Check if mapping has any custom settings
 */
export function hasCustomSettings(mapping: ProjectMapping): boolean {
  return !!(
    mapping.conflictResolutionOverride ||
    mapping.fileTypesOverride ||
    mapping.excludePatternsOverride
  );
}

/**
 * Get description of custom settings for tooltip
 */
export function getCustomSettingsDescription(
  mapping: ProjectMapping,
  globalSettings: EVCLocalSyncSettings
): string[] {
  const descriptions: string[] = [];

  if (mapping.conflictResolutionOverride) {
    const labels: Record<string, string> = {
      "newer-wins": "Newer file wins",
      "always-ask": "Always ask",
      "ai-wins": "AI project wins",
      "obsidian-wins": "Obsidian wins",
    };
    descriptions.push(`Conflict resolution: ${labels[mapping.conflictResolutionOverride]}`);
  }

  if (mapping.fileTypesOverride) {
    descriptions.push(`File types: ${mapping.fileTypesOverride.join(", ")}`);
  }

  if (mapping.excludePatternsOverride) {
    descriptions.push(`Excludes: ${mapping.excludePatternsOverride.join(", ")}`);
  }

  return descriptions;
}
