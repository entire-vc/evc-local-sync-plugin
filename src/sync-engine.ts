import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { ProjectMapping, EVCLocalSyncSettings } from "./settings";
import { ConflictResolver, type ConflictInfo, type ResolutionDecision } from "./conflict-resolver";
import { getVaultBasePath } from "./obsidian-internal";
import {
  SyncStateManager,
  getEffectiveConflictResolution,
  getEffectiveFileTypes,
  getEffectiveExcludePatterns,
  type DetectedDeletion,
} from "./sync-state-manager";
import * as fs from "fs";
import * as path from "path";

/**
 * Sync action types
 */
export type SyncAction = "copy" | "update" | "skip" | "conflict" | "delete";

/**
 * Sync direction
 */
export type SyncDirectionType = "ai-to-obs" | "obs-to-ai";

/**
 * Information about a file for sync comparison
 */
export interface FileInfo {
  relativePath: string;
  absolutePath: string;
  mtime: number;
  size: number;
}

/**
 * Result of a single file sync operation
 */
export interface SyncFileResult {
  file: string;
  action: SyncAction;
  direction: SyncDirectionType;
  success: boolean;
  error?: string;
}

/**
 * Result of a full sync operation
 */
export interface SyncResult {
  mapping: ProjectMapping;
  files: SyncFileResult[];
  filesProcessed: number;
  filesCopied: number;
  filesSkipped: number;
  filesDeleted: number;
  conflicts: ConflictInfo[];
  errors: string[];
  startTime: Date;
  endTime: Date;
  duration: number;
  success: boolean;
  error?: string;
}

/**
 * Planned sync action for dry-run
 */
export interface PlannedSyncAction {
  file: string;
  action: SyncAction;
  direction: SyncDirectionType;
  sourcePath: string;
  targetPath: string;
  reason: string;
}

/**
 * Dry-run result
 */
export interface DryRunResult {
  mapping: ProjectMapping;
  plannedActions: PlannedSyncAction[];
  plannedDeletions: DetectedDeletion[];
  errors: string[];
}

/**
 * Hardcoded exclusion patterns (FR-011)
 * Note: .obsidian is added dynamically from app.vault.configDir
 */
const HARDCODED_EXCLUSIONS = [
  "node_modules",
  ".git",
  ".DS_Store",
  ".space",
];

/**
 * Callback for showing conflict modal and getting user decision
 */
export type ConflictModalCallback = (conflict: ConflictInfo) => Promise<ResolutionDecision>;

/**
 * Callback for confirming deletions
 */
export type DeletionConfirmCallback = (deletions: DetectedDeletion[]) => Promise<boolean>;

/**
 * Core sync engine that handles file synchronization
 */
export class SyncEngine {
  private app: App;
  private settings: EVCLocalSyncSettings;
  private conflictResolver: ConflictResolver;
  private conflictModalCallback: ConflictModalCallback | null = null;
  private deletionConfirmCallback: DeletionConfirmCallback | null = null;
  private syncStateManager: SyncStateManager;

  constructor(app: App, settings: EVCLocalSyncSettings, pluginDir: string) {
    this.app = app;
    this.settings = settings;
    this.conflictResolver = new ConflictResolver(app, settings.conflictResolution);
    this.syncStateManager = new SyncStateManager(app, pluginDir);
  }

  /**
   * Initialize sync state (load from disk)
   */
  async init(): Promise<void> {
    await this.syncStateManager.load();
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: EVCLocalSyncSettings): void {
    this.settings = settings;
    this.conflictResolver.setStrategy(settings.conflictResolution);
  }

  /**
   * Set callback for showing conflict modal (used for "always-ask" strategy)
   */
  setConflictModalCallback(callback: ConflictModalCallback): void {
    this.conflictModalCallback = callback;
  }

  /**
   * Set callback for confirming deletions
   */
  setDeletionConfirmCallback(callback: DeletionConfirmCallback): void {
    this.deletionConfirmCallback = callback;
  }

  /**
   * Sync all enabled mappings
   */
  async syncAll(): Promise<SyncResult[]> {
    const enabledMappings = this.settings.mappings.filter((m) => m.syncEnabled);
    const results: SyncResult[] = [];

    for (const mapping of enabledMappings) {
      try {
        const result = await this.syncMapping(mapping);
        results.push(result);
      } catch (error) {
        results.push({
          mapping,
          files: [],
          filesProcessed: 0,
          filesCopied: 0,
          filesSkipped: 0,
          filesDeleted: 0,
          conflicts: [],
          errors: [(error as Error).message],
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
          success: false,
          error: (error as Error).message,
        });
      }
    }

    return results;
  }

  /**
   * Sync a specific mapping
   */
  async syncMapping(mapping: ProjectMapping): Promise<SyncResult> {
    const startTime = new Date();
    const files: SyncFileResult[] = [];
    const conflicts: ConflictInfo[] = [];
    const errors: string[] = [];
    let filesCopied = 0;
    let filesSkipped = 0;
    let filesDeleted = 0;

    // Get effective settings for this mapping (FR-061, FR-062)
    const effectiveConflictResolution = getEffectiveConflictResolution(mapping, this.settings);

    try {
      // Get paths
      const aiDocsPath = this.getAiDocsPath(mapping);
      const obsDocsPath = this.getObsidianDocsPath(mapping);

      // Validate paths exist
      if (!this.validateAiPath(aiDocsPath)) {
        throw new Error(`AI docs path does not exist: ${aiDocsPath}`);
      }

      // Ensure Obsidian folder exists
      await this.ensureObsidianFolder(obsDocsPath);

      // Get file lists from both sides (using per-mapping settings)
      const aiFiles = this.getFileListForMapping(aiDocsPath, mapping);
      const obsFiles = await this.getObsidianFileListForMapping(obsDocsPath, mapping);

      // Create lookup maps for faster comparison
      const aiFileMap = new Map(aiFiles.map((f) => [f.relativePath, f]));
      const obsFileMap = new Map(obsFiles.map((f) => [f.relativePath, f]));

      // Handle deletions if enabled (FR-060)
      if (this.settings.syncDeletions) {
        const deletions = this.syncStateManager.detectDeletions(
          mapping.id,
          aiFileMap,
          obsFileMap,
          aiDocsPath,
          obsDocsPath,
          mapping.bidirectional
        );

        if (deletions.length > 0) {
          // Confirm deletions if setting is enabled
          let shouldDelete = true;
          if (this.settings.confirmDeletions && this.deletionConfirmCallback) {
            shouldDelete = await this.deletionConfirmCallback(deletions);
          }

          if (shouldDelete) {
            for (const deletion of deletions) {
              try {
                await this.deleteFile(deletion);
                files.push({
                  file: deletion.relativePath,
                  action: "delete",
                  direction: deletion.existsIn === "obsidian" ? "ai-to-obs" : "obs-to-ai",
                  success: true,
                });
                filesDeleted++;

                // Remove from maps so we don't try to copy them
                if (deletion.existsIn === "obsidian") {
                  obsFileMap.delete(deletion.relativePath);
                } else {
                  aiFileMap.delete(deletion.relativePath);
                }
              } catch (error) {
                const errorMsg = `Failed to delete ${deletion.relativePath}: ${(error as Error).message}`;
                errors.push(errorMsg);
                files.push({
                  file: deletion.relativePath,
                  action: "delete",
                  direction: deletion.existsIn === "obsidian" ? "ai-to-obs" : "obs-to-ai",
                  success: false,
                  error: errorMsg,
                });
              }
            }
          }
        }
      }

      // Process files from AI -> Obsidian
      for (const [relativePath, aiFile] of aiFileMap) {
        const obsFile = obsFileMap.get(relativePath);

        if (!obsFile) {
          // File only in AI -> copy to Obsidian
          try {
            await this.copyFileToObsidian(aiFile.absolutePath, obsDocsPath, relativePath);
            files.push({
              file: relativePath,
              action: "copy",
              direction: "ai-to-obs",
              success: true,
            });
            filesCopied++;
          } catch (error) {
            const errorMsg = `Failed to copy ${relativePath}: ${(error as Error).message}`;
            errors.push(errorMsg);
            files.push({
              file: relativePath,
              action: "copy",
              direction: "ai-to-obs",
              success: false,
              error: errorMsg,
            });
          }
        } else {
          // File exists in both - check for conflict
          const comparison = this.compareFileTimes(aiFile, obsFile);

          if (comparison === "same") {
            // Files are the same, skip
            files.push({
              file: relativePath,
              action: "skip",
              direction: "ai-to-obs",
              success: true,
            });
            filesSkipped++;
          } else {
            // Handle conflict
            const conflictInfo: ConflictInfo = {
              relativePath,
              aiPath: aiFile.absolutePath,
              obsidianPath: obsFile.absolutePath,
              aiMtime: new Date(aiFile.mtime),
              obsidianMtime: new Date(obsFile.mtime),
              aiSize: aiFile.size,
              obsidianSize: obsFile.size,
            };
            conflicts.push(conflictInfo);

            // Get resolution - use modal callback for "always-ask" strategy
            // Use per-mapping conflict resolution (FR-061)
            this.conflictResolver.setStrategy(effectiveConflictResolution);
            let resolution = this.conflictResolver.resolve(conflictInfo);

            if (effectiveConflictResolution === "always-ask" && this.conflictModalCallback) {
              const userDecision = await this.conflictModalCallback(conflictInfo);
              resolution = this.conflictResolver.resolveWithUserChoice(conflictInfo, userDecision);
            }

            if (resolution.decision === "use-ai") {
              try {
                await this.copyFileToObsidian(aiFile.absolutePath, obsDocsPath, relativePath);
                files.push({
                  file: relativePath,
                  action: "update",
                  direction: "ai-to-obs",
                  success: true,
                });
                filesCopied++;
              } catch (error) {
                const errorMsg = `Failed to update ${relativePath}: ${(error as Error).message}`;
                errors.push(errorMsg);
                files.push({
                  file: relativePath,
                  action: "update",
                  direction: "ai-to-obs",
                  success: false,
                  error: errorMsg,
                });
              }
            } else if (resolution.decision === "use-obsidian" && mapping.bidirectional) {
              try {
                await this.copyFileToAi(obsFile.absolutePath, aiDocsPath, relativePath);
                files.push({
                  file: relativePath,
                  action: "update",
                  direction: "obs-to-ai",
                  success: true,
                });
                filesCopied++;
              } catch (error) {
                const errorMsg = `Failed to update ${relativePath}: ${(error as Error).message}`;
                errors.push(errorMsg);
                files.push({
                  file: relativePath,
                  action: "update",
                  direction: "obs-to-ai",
                  success: false,
                  error: errorMsg,
                });
              }
            } else {
              // Skip
              files.push({
                file: relativePath,
                action: "skip",
                direction: "ai-to-obs",
                success: true,
              });
              filesSkipped++;
            }
          }
        }
      }

      // Process files from Obsidian -> AI (if bidirectional)
      if (mapping.bidirectional) {
        for (const [relativePath, obsFile] of obsFileMap) {
          if (!aiFileMap.has(relativePath)) {
            // File only in Obsidian -> copy to AI
            try {
              await this.copyFileToAi(obsFile.absolutePath, aiDocsPath, relativePath);
              files.push({
                file: relativePath,
                action: "copy",
                direction: "obs-to-ai",
                success: true,
              });
              filesCopied++;
            } catch (error) {
              const errorMsg = `Failed to copy ${relativePath}: ${(error as Error).message}`;
              errors.push(errorMsg);
              files.push({
                file: relativePath,
                action: "copy",
                direction: "obs-to-ai",
                success: false,
                error: errorMsg,
              });
            }
          }
          // Files in both are already handled above
        }
      } else if (mapping.syncDirection === "obs-to-ai") {
        // Unidirectional: Obsidian -> AI only
        for (const [relativePath, obsFile] of obsFileMap) {
          const aiFile = aiFileMap.get(relativePath);

          if (!aiFile) {
            // File only in Obsidian -> copy to AI
            try {
              await this.copyFileToAi(obsFile.absolutePath, aiDocsPath, relativePath);
              files.push({
                file: relativePath,
                action: "copy",
                direction: "obs-to-ai",
                success: true,
              });
              filesCopied++;
            } catch (error) {
              const errorMsg = `Failed to copy ${relativePath}: ${(error as Error).message}`;
              errors.push(errorMsg);
              files.push({
                file: relativePath,
                action: "copy",
                direction: "obs-to-ai",
                success: false,
                error: errorMsg,
              });
            }
          } else {
            // File exists in both - check for conflict (Obsidian is source)
            const comparison = this.compareFileTimes(aiFile, obsFile);

            if (comparison !== "same" && obsFile.mtime > aiFile.mtime) {
              try {
                await this.copyFileToAi(obsFile.absolutePath, aiDocsPath, relativePath);
                files.push({
                  file: relativePath,
                  action: "update",
                  direction: "obs-to-ai",
                  success: true,
                });
                filesCopied++;
              } catch (error) {
                const errorMsg = `Failed to update ${relativePath}: ${(error as Error).message}`;
                errors.push(errorMsg);
                files.push({
                  file: relativePath,
                  action: "update",
                  direction: "obs-to-ai",
                  success: false,
                  error: errorMsg,
                });
              }
            }
          }
        }
      }

      // Update sync state after successful sync (FR-060)
      if (this.settings.syncDeletions) {
        const aiStates = await this.syncStateManager.buildFileState(aiFiles);
        const obsStates = await this.syncStateManager.buildFileState(obsFiles);
        this.syncStateManager.updateState(mapping.id, aiStates, obsStates);
        await this.syncStateManager.save();
      }

      const endTime = new Date();

      return {
        mapping,
        files,
        filesProcessed: files.length,
        filesCopied,
        filesSkipped,
        filesDeleted,
        conflicts,
        errors,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        success: errors.length === 0,
      };
    } catch (error) {
      const endTime = new Date();
      return {
        mapping,
        files,
        filesProcessed: files.length,
        filesCopied,
        filesSkipped,
        filesDeleted,
        conflicts,
        errors: [...errors, (error as Error).message],
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Perform a dry-run for all enabled mappings
   */
  async dryRunAll(): Promise<DryRunResult[]> {
    const enabledMappings = this.settings.mappings.filter((m) => m.syncEnabled);
    const results: DryRunResult[] = [];

    for (const mapping of enabledMappings) {
      try {
        const result = await this.dryRunMapping(mapping);
        results.push(result);
      } catch (error) {
        results.push({
          mapping,
          plannedActions: [],
          plannedDeletions: [],
          errors: [(error as Error).message],
        });
      }
    }

    return results;
  }

  /**
   * Perform a dry-run for a specific mapping
   */
  async dryRunMapping(mapping: ProjectMapping): Promise<DryRunResult> {
    const plannedActions: PlannedSyncAction[] = [];
    const plannedDeletions: DetectedDeletion[] = [];
    const errors: string[] = [];

    try {
      // Get paths
      const aiDocsPath = this.getAiDocsPath(mapping);
      const obsDocsPath = this.getObsidianDocsPath(mapping);

      // Validate AI path exists
      if (!this.validateAiPath(aiDocsPath)) {
        errors.push(`AI docs path does not exist: ${aiDocsPath}`);
        return { mapping, plannedActions, plannedDeletions, errors };
      }

      // Get file lists from both sides (using per-mapping settings)
      const aiFiles = this.getFileListForMapping(aiDocsPath, mapping);
      const obsFiles = await this.getObsidianFileListForMapping(obsDocsPath, mapping);

      // Create lookup maps
      const aiFileMap = new Map(aiFiles.map((f) => [f.relativePath, f]));
      const obsFileMap = new Map(obsFiles.map((f) => [f.relativePath, f]));

      // Detect planned deletions (FR-060)
      if (this.settings.syncDeletions) {
        const deletions = this.syncStateManager.detectDeletions(
          mapping.id,
          aiFileMap,
          obsFileMap,
          aiDocsPath,
          obsDocsPath,
          mapping.bidirectional
        );
        plannedDeletions.push(...deletions);
      }

      // Check AI -> Obsidian
      for (const [relativePath, aiFile] of aiFileMap) {
        const obsFile = obsFileMap.get(relativePath);
        const targetPath = path.join(obsDocsPath, relativePath);

        if (!obsFile) {
          plannedActions.push({
            file: relativePath,
            action: "copy",
            direction: "ai-to-obs",
            sourcePath: aiFile.absolutePath,
            targetPath,
            reason: "File exists only in AI project",
          });
        } else {
          const comparison = this.compareFileTimes(aiFile, obsFile);

          if (comparison === "ai-newer") {
            plannedActions.push({
              file: relativePath,
              action: "update",
              direction: "ai-to-obs",
              sourcePath: aiFile.absolutePath,
              targetPath: obsFile.absolutePath,
              reason: "AI version is newer",
            });
          } else if (comparison === "obs-newer" && !mapping.bidirectional) {
            plannedActions.push({
              file: relativePath,
              action: "skip",
              direction: "ai-to-obs",
              sourcePath: aiFile.absolutePath,
              targetPath: obsFile.absolutePath,
              reason: "Obsidian version is newer (unidirectional sync)",
            });
          }
        }
      }

      // Check Obsidian -> AI (if bidirectional or obs-to-ai direction)
      if (mapping.bidirectional || mapping.syncDirection === "obs-to-ai") {
        for (const [relativePath, obsFile] of obsFileMap) {
          const aiFile = aiFileMap.get(relativePath);
          const targetPath = path.join(aiDocsPath, relativePath);

          if (!aiFile) {
            plannedActions.push({
              file: relativePath,
              action: "copy",
              direction: "obs-to-ai",
              sourcePath: obsFile.absolutePath,
              targetPath,
              reason: "File exists only in Obsidian",
            });
          } else if (mapping.bidirectional) {
            const comparison = this.compareFileTimes(aiFile, obsFile);

            if (comparison === "obs-newer") {
              plannedActions.push({
                file: relativePath,
                action: "update",
                direction: "obs-to-ai",
                sourcePath: obsFile.absolutePath,
                targetPath: aiFile.absolutePath,
                reason: "Obsidian version is newer",
              });
            }
          }
        }
      }

      return { mapping, plannedActions, plannedDeletions, errors };
    } catch (error) {
      errors.push((error as Error).message);
      return { mapping, plannedActions, plannedDeletions, errors };
    }
  }

  /**
   * Get file list from external directory (AI project)
   */
  private getFileList(dirPath: string, _isObsidian: boolean): FileInfo[] {
    const files: FileInfo[] = [];
    const followSymlinks = this.settings.followSymlinks;

    const walkDir = (currentPath: string, basePath: string): void => {
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const entryPath = path.join(currentPath, entry.name);
          const relativePath = path.relative(basePath, entryPath);

          // Check exclusions
          if (this.shouldExclude(entry.name)) {
            continue;
          }

          // Handle symlinks
          let isDir = entry.isDirectory();
          let isFile = entry.isFile();

          if (entry.isSymbolicLink()) {
            if (!followSymlinks) {
              continue; // Skip symlinks if not following
            }
            // Resolve symlink to determine actual type
            try {
              const realPath = fs.realpathSync(entryPath);
              const realStats = fs.statSync(realPath);
              isDir = realStats.isDirectory();
              isFile = realStats.isFile();
            } catch {
              continue; // Skip broken symlinks
            }
          }

          if (isDir) {
            walkDir(entryPath, basePath);
          } else if (isFile) {
            if (this.shouldIncludeFile(entry.name)) {
              try {
                const stats = fs.statSync(entryPath);
                files.push({
                  relativePath: this.normalizeRelativePath(relativePath),
                  absolutePath: entryPath,
                  mtime: stats.mtimeMs,
                  size: stats.size,
                });
              } catch {
                // Skip files we can't stat
              }
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    walkDir(dirPath, dirPath);
    return files;
  }

  /**
   * Get file list from external directory with per-mapping settings (FR-061, FR-062)
   */
  private getFileListForMapping(dirPath: string, mapping: ProjectMapping): FileInfo[] {
    const files: FileInfo[] = [];
    const followSymlinks = this.settings.followSymlinks;
    const fileTypes = getEffectiveFileTypes(mapping, this.settings);
    const excludePatterns = getEffectiveExcludePatterns(mapping, this.settings);

    const walkDir = (currentPath: string, basePath: string): void => {
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const entryPath = path.join(currentPath, entry.name);
          const relativePath = path.relative(basePath, entryPath);

          // Check exclusions (per-mapping)
          if (this.shouldExcludeForMapping(entry.name, excludePatterns)) {
            continue;
          }

          // Handle symlinks
          let isDir = entry.isDirectory();
          let isFile = entry.isFile();

          if (entry.isSymbolicLink()) {
            if (!followSymlinks) {
              continue;
            }
            try {
              const realPath = fs.realpathSync(entryPath);
              const realStats = fs.statSync(realPath);
              isDir = realStats.isDirectory();
              isFile = realStats.isFile();
            } catch {
              continue;
            }
          }

          if (isDir) {
            walkDir(entryPath, basePath);
          } else if (isFile) {
            if (this.shouldIncludeFileForMapping(entry.name, fileTypes)) {
              try {
                const stats = fs.statSync(entryPath);
                files.push({
                  relativePath: this.normalizeRelativePath(relativePath),
                  absolutePath: entryPath,
                  mtime: stats.mtimeMs,
                  size: stats.size,
                });
              } catch {
                // Skip files we can't stat
              }
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    walkDir(dirPath, dirPath);
    return files;
  }

  /**
   * Get file list from Obsidian vault
   */
  private async getObsidianFileList(obsDocsPath: string): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    const normalizedPath = normalizePath(obsDocsPath);

    const folder = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!folder || !(folder instanceof TFolder)) {
      return files;
    }

    const walkFolder = async (currentFolder: TFolder, basePath: string): Promise<void> => {
      for (const child of currentFolder.children) {
        // Check exclusions
        if (this.shouldExclude(child.name)) {
          continue;
        }

        if (child instanceof TFolder) {
          await walkFolder(child, basePath);
        } else if (child instanceof TFile) {
          if (this.shouldIncludeFile(child.name)) {
            const relativePath = child.path.slice(basePath.length).replace(/^\//, "");
            const stats = await this.app.vault.adapter.stat(child.path);

            if (stats) {
              // Get absolute path for Obsidian files
              const vaultBasePath = getVaultBasePath(this.app);
              const absolutePath = path.join(vaultBasePath, child.path);

              files.push({
                relativePath: this.normalizeRelativePath(relativePath),
                absolutePath,
                mtime: stats.mtime,
                size: stats.size,
              });
            }
          }
        }
      }
    };

    await walkFolder(folder, normalizedPath);
    return files;
  }

  /**
   * Get file list from Obsidian vault with per-mapping settings (FR-061, FR-062)
   */
  private async getObsidianFileListForMapping(obsDocsPath: string, mapping: ProjectMapping): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    const normalizedPath = normalizePath(obsDocsPath);
    const fileTypes = getEffectiveFileTypes(mapping, this.settings);
    const excludePatterns = getEffectiveExcludePatterns(mapping, this.settings);

    const folder = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!folder || !(folder instanceof TFolder)) {
      return files;
    }

    const walkFolder = async (currentFolder: TFolder, basePath: string): Promise<void> => {
      for (const child of currentFolder.children) {
        // Check exclusions (per-mapping)
        if (this.shouldExcludeForMapping(child.name, excludePatterns)) {
          continue;
        }

        if (child instanceof TFolder) {
          await walkFolder(child, basePath);
        } else if (child instanceof TFile) {
          if (this.shouldIncludeFileForMapping(child.name, fileTypes)) {
            const relativePath = child.path.slice(basePath.length).replace(/^\//, "");
            const stats = await this.app.vault.adapter.stat(child.path);

            if (stats) {
              const vaultBasePath = getVaultBasePath(this.app);
              const absolutePath = path.join(vaultBasePath, child.path);

              files.push({
                relativePath: this.normalizeRelativePath(relativePath),
                absolutePath,
                mtime: stats.mtime,
                size: stats.size,
              });
            }
          }
        }
      }
    };

    await walkFolder(folder, normalizedPath);
    return files;
  }

  /**
   * Check if file should be included based on file type filter (FR-010)
   */
  private shouldIncludeFile(filename: string): boolean {
    const fileTypes = this.settings.fileTypes;

    // Handle special case for .excalidraw.md
    for (const ext of fileTypes) {
      if (ext.includes(".") && ext.length > 3) {
        // Multi-part extension like .excalidraw.md
        if (filename.endsWith(ext)) {
          return true;
        }
      } else {
        // Simple extension like .md
        if (filename.endsWith(ext)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if file should be included based on per-mapping file types (FR-062)
   */
  private shouldIncludeFileForMapping(filename: string, fileTypes: string[]): boolean {
    for (const ext of fileTypes) {
      if (ext.includes(".") && ext.length > 3) {
        // Multi-part extension like .excalidraw.md
        if (filename.endsWith(ext)) {
          return true;
        }
      } else {
        // Simple extension like .md
        if (filename.endsWith(ext)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if path should be excluded based on per-mapping patterns (FR-062)
   */
  private shouldExcludeForMapping(pathSegment: string, excludePatterns: string[]): boolean {
    // Check hardcoded exclusions
    for (const exclusion of HARDCODED_EXCLUSIONS) {
      if (pathSegment === exclusion || pathSegment.startsWith(exclusion + "/")) {
        return true;
      }
    }

    // Check config directory (dynamically from vault)
    const configDir = this.app.vault.configDir;
    if (pathSegment === configDir || pathSegment.startsWith(configDir + "/")) {
      return true;
    }

    // Check per-mapping exclusions
    for (const pattern of excludePatterns) {
      if (pathSegment === pattern || pathSegment.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if path should be excluded (FR-011)
   */
  private shouldExclude(pathSegment: string): boolean {
    // Check hardcoded exclusions
    for (const exclusion of HARDCODED_EXCLUSIONS) {
      if (pathSegment === exclusion || pathSegment.startsWith(exclusion + "/")) {
        return true;
      }
    }

    // Check config directory (dynamically from vault)
    const configDir = this.app.vault.configDir;
    if (pathSegment === configDir || pathSegment.startsWith(configDir + "/")) {
      return true;
    }

    // Check user-defined exclusions
    for (const pattern of this.settings.excludePatterns) {
      if (pathSegment === pattern || pathSegment.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Compare file modification times
   */
  private compareFileTimes(aiFile: FileInfo, obsFile: FileInfo): "same" | "ai-newer" | "obs-newer" {
    // Consider files "same" if mtime difference is less than 1 second
    const timeDiff = Math.abs(aiFile.mtime - obsFile.mtime);

    if (timeDiff < 1000) {
      return "same";
    }

    return aiFile.mtime > obsFile.mtime ? "ai-newer" : "obs-newer";
  }

  /**
   * Copy file from AI project to Obsidian vault
   */
  private async copyFileToObsidian(
    sourcePath: string,
    obsDocsPath: string,
    relativePath: string
  ): Promise<void> {
    const targetPath = normalizePath(path.join(obsDocsPath, relativePath));

    // Ensure parent directory exists
    const parentDir = normalizePath(path.dirname(targetPath));
    await this.ensureObsidianFolder(parentDir);

    // Read source file and get its mtime
    const sourceStats = fs.statSync(sourcePath);
    const sourceMtime = sourceStats.mtime;
    const content = fs.readFileSync(sourcePath, "utf-8");

    // Create backup if enabled
    if (this.settings.createBackups) {
      const existingFile = this.app.vault.getAbstractFileByPath(targetPath);
      if (existingFile instanceof TFile) {
        await this.createObsidianBackup(existingFile);
      }
    }

    // Write to Obsidian vault
    const existingFile = this.app.vault.getAbstractFileByPath(targetPath);
    if (existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, content);
    } else {
      await this.app.vault.create(targetPath, content);
    }

    // Preserve source file mtime on target using fs directly
    const vaultBasePath = getVaultBasePath(this.app);
    const absoluteTargetPath = path.join(vaultBasePath, targetPath);
    if (fs.existsSync(absoluteTargetPath)) {
      fs.utimesSync(absoluteTargetPath, sourceMtime, sourceMtime);
    }
  }

  /**
   * Copy file from Obsidian vault to AI project
   */
  private async copyFileToAi(
    sourcePath: string,
    aiDocsPath: string,
    relativePath: string
  ): Promise<void> {
    const targetPath = path.join(aiDocsPath, relativePath);

    // Ensure parent directory exists
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Create backup if enabled
    if (this.settings.createBackups && fs.existsSync(targetPath)) {
      this.createAiBackup(targetPath);
    }

    // Read from Obsidian vault using the abstract file path
    const vaultBasePath = getVaultBasePath(this.app);
    const vaultPath = sourcePath.replace(vaultBasePath, "").replace(/^[/\\]/, "");
    const normalizedVaultPath = normalizePath(vaultPath);

    const file = this.app.vault.getAbstractFileByPath(normalizedVaultPath);

    let sourceMtime: Date | null = null;
    if (file instanceof TFile) {
      const content = await this.app.vault.read(file);
      sourceMtime = new Date(file.stat.mtime);
      fs.writeFileSync(targetPath, content, "utf-8");
    } else {
      // Fallback: read directly from source path
      const sourceStats = fs.statSync(sourcePath);
      sourceMtime = sourceStats.mtime;
      const content = fs.readFileSync(sourcePath, "utf-8");
      fs.writeFileSync(targetPath, content, "utf-8");
    }

    // Preserve source file mtime on target
    if (sourceMtime) {
      fs.utimesSync(targetPath, sourceMtime, sourceMtime);
    }
  }

  /**
   * Create backup of Obsidian file before overwrite
   */
  private async createObsidianBackup(file: TFile): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = normalizePath(
      `${file.path}.backup-${timestamp}`
    );

    const content = await this.app.vault.read(file);
    await this.app.vault.create(backupPath, content);
  }

  /**
   * Create backup of AI project file before overwrite
   */
  private createAiBackup(filePath: string): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${filePath}.backup-${timestamp}`;

    const content = fs.readFileSync(filePath, "utf-8");
    fs.writeFileSync(backupPath, content, "utf-8");
  }

  /**
   * Delete a file (FR-060)
   */
  private async deleteFile(deletion: DetectedDeletion): Promise<void> {
    // Create backup before deletion if enabled
    if (this.settings.createBackups) {
      if (deletion.existsIn === "obsidian") {
        // Backup Obsidian file
        const vaultBasePath = getVaultBasePath(this.app);
        const vaultPath = deletion.targetPath.replace(vaultBasePath, "").replace(/^[/\\]/, "");
        const normalizedPath = normalizePath(vaultPath);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (file instanceof TFile) {
          await this.createObsidianBackup(file);
        }
      } else {
        // Backup AI file
        if (fs.existsSync(deletion.targetPath)) {
          this.createAiBackup(deletion.targetPath);
        }
      }
    }

    // Delete the file
    if (deletion.existsIn === "obsidian") {
      const vaultBasePath = getVaultBasePath(this.app);
      const vaultPath = deletion.targetPath.replace(vaultBasePath, "").replace(/^[/\\]/, "");
      const normalizedPath = normalizePath(vaultPath);
      const file = this.app.vault.getAbstractFileByPath(normalizedPath);
      if (file instanceof TFile) {
        await this.app.fileManager.trashFile(file);
      }
    } else {
      // Delete AI project file
      if (fs.existsSync(deletion.targetPath)) {
        fs.unlinkSync(deletion.targetPath);
      }
    }
  }

  /**
   * Ensure Obsidian folder exists
   */
  private async ensureObsidianFolder(folderPath: string): Promise<void> {
    const normalizedPath = normalizePath(folderPath);

    if (!normalizedPath || normalizedPath === ".") {
      return;
    }

    const folder = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!folder) {
      // Create folder recursively
      await this.app.vault.createFolder(normalizedPath);
    }
  }

  /**
   * Get full docs path for AI project
   */
  private getAiDocsPath(mapping: ProjectMapping): string {
    const basePath = mapping.aiPath.replace(/^~/, process.env.HOME || "");
    if (mapping.docsSubdir && mapping.docsSubdir.trim().length > 0) {
      return path.join(basePath, mapping.docsSubdir);
    }
    return basePath;
  }

  /**
   * Get full docs path for Obsidian
   */
  private getObsidianDocsPath(mapping: ProjectMapping): string {
    if (mapping.docsSubdir && mapping.docsSubdir.trim().length > 0) {
      return normalizePath(path.join(mapping.obsidianPath, mapping.docsSubdir));
    }
    return normalizePath(mapping.obsidianPath);
  }

  /**
   * Validate AI path exists
   */
  private validateAiPath(aiPath: string): boolean {
    try {
      return fs.existsSync(aiPath) && fs.statSync(aiPath).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Normalize relative path to use forward slashes
   */
  private normalizeRelativePath(relativePath: string): string {
    return relativePath.replace(/\\/g, "/");
  }
}
