import { App, normalizePath } from "obsidian";
import type { ProjectMapping, EVCLocalSyncSettings } from "./settings";
import * as fs from "fs";
import * as path from "path";

/**
 * Validation result for a mapping
 */
export interface MappingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Generate unique ID for mappings
 */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

/**
 * Manager for project mappings CRUD operations (FR-001, FR-002, FR-003)
 */
export class MappingManager {
  private app: App;
  private settings: EVCLocalSyncSettings;
  private onSettingsChange: () => Promise<void>;

  constructor(
    app: App,
    settings: EVCLocalSyncSettings,
    onSettingsChange: () => Promise<void>
  ) {
    this.app = app;
    this.settings = settings;
    this.onSettingsChange = onSettingsChange;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: EVCLocalSyncSettings): void {
    this.settings = settings;
  }

  /**
   * Get all mappings
   */
  getAll(): ProjectMapping[] {
    return [...this.settings.mappings];
  }

  /**
   * Get enabled mappings only
   */
  getEnabled(): ProjectMapping[] {
    return this.settings.mappings.filter((m) => m.syncEnabled);
  }

  /**
   * Get a mapping by ID
   */
  getById(id: string): ProjectMapping | undefined {
    return this.settings.mappings.find((m) => m.id === id);
  }

  /**
   * Add a new mapping (FR-001)
   */
  async add(mapping: Omit<ProjectMapping, "id">): Promise<ProjectMapping> {
    // Validate before adding
    const validation = await this.validate(mapping);
    if (!validation.valid) {
      throw new Error(`Invalid mapping: ${validation.errors.join(", ")}`);
    }

    const newMapping: ProjectMapping = {
      ...mapping,
      id: generateId(),
    };

    this.settings.mappings.push(newMapping);
    await this.onSettingsChange();

    return newMapping;
  }

  /**
   * Update an existing mapping (FR-002)
   */
  async update(
    id: string,
    updates: Partial<Omit<ProjectMapping, "id">>
  ): Promise<ProjectMapping> {
    const index = this.settings.mappings.findIndex((m) => m.id === id);
    if (index === -1) {
      throw new Error(`Mapping with id "${id}" not found`);
    }

    const existingMapping = this.settings.mappings[index];
    const updatedMapping: ProjectMapping = {
      ...existingMapping,
      ...updates,
    };

    // Validate if paths changed
    if (
      updates.aiPath !== undefined ||
      updates.obsidianPath !== undefined ||
      updates.docsSubdir !== undefined
    ) {
      const validation = await this.validate(updatedMapping, id);
      if (!validation.valid) {
        throw new Error(`Invalid mapping: ${validation.errors.join(", ")}`);
      }
    }

    this.settings.mappings[index] = updatedMapping;
    await this.onSettingsChange();

    return updatedMapping;
  }

  /**
   * Delete a mapping
   */
  async delete(id: string): Promise<void> {
    const index = this.settings.mappings.findIndex((m) => m.id === id);
    if (index === -1) {
      throw new Error(`Mapping with id "${id}" not found`);
    }

    this.settings.mappings.splice(index, 1);
    await this.onSettingsChange();
  }

  /**
   * Toggle sync enabled state
   */
  async toggleEnabled(id: string): Promise<boolean> {
    const mapping = this.getById(id);
    if (!mapping) {
      throw new Error(`Mapping with id "${id}" not found`);
    }

    const newState = !mapping.syncEnabled;
    await this.update(id, { syncEnabled: newState });

    return newState;
  }

  /**
   * Validate a mapping configuration (FR-003)
   * @param mapping - The mapping to validate
   * @param excludeId - ID to exclude from duplicate check (for edit mode)
   */
  async validate(
    mapping: Omit<ProjectMapping, "id"> & { id?: string },
    excludeId?: string
  ): Promise<MappingValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate name
    if (!mapping.name || mapping.name.trim().length === 0) {
      errors.push("Mapping name is required");
    }

    // Validate AI path
    if (!mapping.aiPath || mapping.aiPath.trim().length === 0) {
      errors.push("AI project path is required");
    } else {
      const aiPathValid = await this.validateExternalPath(mapping.aiPath);
      if (!aiPathValid.exists) {
        errors.push(`AI project path does not exist: ${mapping.aiPath}`);
      } else if (!aiPathValid.isDirectory) {
        errors.push(`AI project path is not a directory: ${mapping.aiPath}`);
      }
    }

    // Validate Obsidian path
    if (!mapping.obsidianPath || mapping.obsidianPath.trim().length === 0) {
      errors.push("Obsidian folder path is required");
    } else {
      const obsPathValid = this.validateObsidianPath(mapping.obsidianPath);
      if (!obsPathValid.exists) {
        warnings.push(
          `Obsidian folder does not exist yet: ${mapping.obsidianPath}. It will be created during sync.`
        );
      }
    }

    // Validate docs subdirectory
    if (!mapping.docsSubdir || mapping.docsSubdir.trim().length === 0) {
      warnings.push('Docs subdirectory is empty. Will sync from root of paths.');
    }

    // Validate sync direction for non-bidirectional
    if (!mapping.bidirectional && !mapping.syncDirection) {
      errors.push("Sync direction is required for unidirectional sync");
    }

    // Check for duplicate mappings (same AI path)
    // Exclude the mapping being edited (if excludeId is provided)
    const idToExclude = excludeId || (mapping as ProjectMapping).id;
    const existingMapping = this.settings.mappings.find(
      (m) =>
        m.aiPath === mapping.aiPath &&
        m.docsSubdir === mapping.docsSubdir &&
        m.id !== idToExclude
    );
    if (existingMapping) {
      warnings.push(
        `Another mapping already exists for this AI path: "${existingMapping.name}"`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate an external filesystem path (FR-003)
   */
  private async validateExternalPath(
    externalPath: string
  ): Promise<{ exists: boolean; isDirectory: boolean }> {
    try {
      // Expand ~ to home directory
      const expandedPath = externalPath.replace(/^~/, process.env.HOME || "");
      const stats = fs.statSync(expandedPath);
      return {
        exists: true,
        isDirectory: stats.isDirectory(),
      };
    } catch {
      return {
        exists: false,
        isDirectory: false,
      };
    }
  }

  /**
   * Validate an Obsidian vault path
   */
  private validateObsidianPath(
    obsidianPath: string
  ): { exists: boolean; isDirectory: boolean } {
    const normalizedPath = normalizePath(obsidianPath);
    const folder = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!folder) {
      return { exists: false, isDirectory: false };
    }

    // Check if it's a folder (TFolder has children property)
    const isFolder = "children" in folder;
    return {
      exists: true,
      isDirectory: isFolder,
    };
  }

  /**
   * Get full docs path for AI project
   */
  getAiDocsPath(mapping: ProjectMapping): string {
    const basePath = mapping.aiPath.replace(/^~/, process.env.HOME || "");
    if (mapping.docsSubdir && mapping.docsSubdir.trim().length > 0) {
      return path.join(basePath, mapping.docsSubdir);
    }
    return basePath;
  }

  /**
   * Get full docs path for Obsidian
   */
  getObsidianDocsPath(mapping: ProjectMapping): string {
    if (mapping.docsSubdir && mapping.docsSubdir.trim().length > 0) {
      return normalizePath(path.join(mapping.obsidianPath, mapping.docsSubdir));
    }
    return normalizePath(mapping.obsidianPath);
  }

  /**
   * Find mapping by file path (for "sync current project" feature)
   */
  findByFilePath(filePath: string): ProjectMapping | undefined {
    const normalizedFilePath = normalizePath(filePath);

    for (const mapping of this.settings.mappings) {
      const obsDocsPath = this.getObsidianDocsPath(mapping);
      const obsBasePath = normalizePath(mapping.obsidianPath);

      // Check if file is within the mapping's Obsidian path
      if (
        normalizedFilePath.startsWith(obsBasePath + "/") ||
        normalizedFilePath === obsBasePath
      ) {
        return mapping;
      }

      // Also check the docs subdirectory
      if (
        normalizedFilePath.startsWith(obsDocsPath + "/") ||
        normalizedFilePath === obsDocsPath
      ) {
        return mapping;
      }
    }

    return undefined;
  }

  /**
   * Get statistics for a mapping
   */
  async getMappingStats(mapping: ProjectMapping): Promise<{
    aiFileCount: number;
    obsidianFileCount: number;
    lastSync?: Date;
  }> {
    let aiFileCount = 0;
    let obsidianFileCount = 0;

    // Count AI files
    try {
      const aiDocsPath = this.getAiDocsPath(mapping);
      if (fs.existsSync(aiDocsPath)) {
        aiFileCount = this.countFilesInDirectory(
          aiDocsPath,
          this.settings.fileTypes,
          this.settings.excludePatterns
        );
      }
    } catch {
      // Ignore errors
    }

    // Count Obsidian files
    try {
      const obsDocsPath = this.getObsidianDocsPath(mapping);
      const folder = this.app.vault.getAbstractFileByPath(obsDocsPath);
      if (folder && "children" in folder) {
        obsidianFileCount = this.countVaultFiles(
          folder as any,
          this.settings.fileTypes
        );
      }
    } catch {
      // Ignore errors
    }

    return {
      aiFileCount,
      obsidianFileCount,
    };
  }

  /**
   * Count files in an external directory
   */
  private countFilesInDirectory(
    dirPath: string,
    fileTypes: string[],
    excludePatterns: string[]
  ): number {
    let count = 0;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip excluded patterns
        if (excludePatterns.some((pattern) => entry.name.includes(pattern))) {
          continue;
        }

        const entryPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          count += this.countFilesInDirectory(
            entryPath,
            fileTypes,
            excludePatterns
          );
        } else if (entry.isFile()) {
          if (fileTypes.some((ext) => entry.name.endsWith(ext))) {
            count++;
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return count;
  }

  /**
   * Count files in Obsidian vault folder
   */
  private countVaultFiles(
    folder: { children: any[] },
    fileTypes: string[]
  ): number {
    let count = 0;

    for (const child of folder.children) {
      if ("children" in child) {
        // It's a folder
        count += this.countVaultFiles(child, fileTypes);
      } else if ("extension" in child) {
        // It's a file
        const ext = "." + child.extension;
        if (fileTypes.includes(ext)) {
          count++;
        }
      }
    }

    return count;
  }
}
