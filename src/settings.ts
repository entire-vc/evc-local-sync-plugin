import { App, PluginSettingTab, Setting, Notice, ButtonComponent, setIcon } from "obsidian";
import type EVCLocalSyncPlugin from "./main";
import { MappingModal } from "./ui/modals/mapping-modal";
import { showConfirmation } from "./ui/modals/confirmation-modal";
import { EVC_LOGO_BASE64 } from "./logo";
import { hasCustomSettings, getCustomSettingsDescription } from "./sync-state-manager";
import * as fs from "fs";
import * as path from "path";

/**
 * Sync mode options
 */
export type SyncMode = "manual" | "on-change" | "on-startup" | "scheduled";

/**
 * Conflict resolution strategies
 */
export type ConflictResolution =
  | "newer-wins"
  | "always-ask"
  | "ai-wins"
  | "obsidian-wins";

/**
 * Sync direction for unidirectional sync
 */
export type SyncDirection = "ai-to-obs" | "obs-to-ai";

/**
 * Project mapping configuration
 */
export interface ProjectMapping {
  id: string;
  name: string;
  aiPath: string;
  obsidianPath: string;
  docsSubdir: string;
  syncEnabled: boolean;
  bidirectional: boolean;
  syncDirection?: SyncDirection;

  // Per-mapping overrides (FR-061, FR-062)
  /** Override global conflict resolution (undefined = use global) */
  conflictResolutionOverride?: ConflictResolution;
  /** Override global file types (undefined = use global) */
  fileTypesOverride?: string[];
  /** Override global exclude patterns (undefined = use global) */
  excludePatternsOverride?: string[];
}

/**
 * Plugin settings structure (FR-020)
 */
export interface EVCLocalSyncSettings {
  version: string;
  syncMode: SyncMode;
  syncOnStartup: boolean;
  debounceMs: number;
  scheduledIntervalMinutes: number;
  conflictResolution: ConflictResolution;
  createBackups: boolean;
  showAutoSyncNotifications: boolean;
  followSymlinks: boolean;
  fileTypes: string[];
  excludePatterns: string[];
  mappings: ProjectMapping[];
  logRetentionDays: number;
  /** Enable file deletion sync (FR-060) */
  syncDeletions: boolean;
  /** Confirm before deleting files (FR-060) */
  confirmDeletions: boolean;
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: EVCLocalSyncSettings = {
  version: "1.0.1",
  syncMode: "manual",
  syncOnStartup: false,
  debounceMs: 3000,
  scheduledIntervalMinutes: 5,
  conflictResolution: "newer-wins",
  createBackups: true,
  showAutoSyncNotifications: false,
  followSymlinks: false,
  fileTypes: [".md", ".canvas", ".excalidraw.md"],
  excludePatterns: [
    "node_modules",
    ".git",
    ".DS_Store",
    ".space",
  ],
  mappings: [],
  logRetentionDays: 7,
  syncDeletions: false,
  confirmDeletions: true,
};

/**
 * Settings tab for the plugin (FR-020)
 */
export class EVCLocalSyncSettingTab extends PluginSettingTab {
  plugin: EVCLocalSyncPlugin;
  private mappingsContainer: HTMLElement | null = null;

  constructor(app: App, plugin: EVCLocalSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("evc-sync-settings");

    // Header with logo, title, description, and GitHub link
    this.displayHeader(containerEl);

    // General Settings Section
    this.displayGeneralSettings(containerEl);

    // File Types Section
    this.displayFileTypesSettings(containerEl);

    // Project Mappings Section
    this.displayMappingsSettings(containerEl);

    // Actions Section
    this.displayActionsSection(containerEl);
  }

  /**
   * Display header section with logo, title, description, and GitHub link
   */
  private displayHeader(containerEl: HTMLElement): void {
    const header = containerEl.createDiv({ cls: "evc-settings-header" });

    // Icon container with PNG logo
    const iconContainer = header.createDiv({ cls: "evc-settings-icon" });
    iconContainer.createEl("img", {
      attr: {
        src: EVC_LOGO_BASE64,
        alt: "EVC Logo",
        width: "48",
        height: "48",
      },
      cls: "evc-settings-logo",
    });

    // Info container
    const infoContainer = header.createDiv({ cls: "evc-settings-info" });

    // Title
    infoContainer.createEl("div", { text: "Local sync to AI agent", cls: "evc-settings-title" });

    // Description
    infoContainer.createEl("p", {
      text: "Bidirectional sync between Obsidian and AI development projects",
      cls: "evc-settings-description",
    });

    // Issue form links
    const linksContainer = infoContainer.createDiv({ cls: "evc-settings-links" });
    const issueLinks: Array<{ text: string; url: string; icon: string }> = [
      { text: "Bug report", url: "https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=bug-report.yml", icon: "bug" },
      { text: "Feature request", url: "https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=feature-request.yml", icon: "lightbulb" },
      { text: "Conflict case", url: "https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=conflict-case.yml", icon: "alert-triangle" },
    ];
    for (const link of issueLinks) {
      const btn = linksContainer.createEl("a", {
        cls: "evc-settings-issue-link",
        href: link.url,
      });
      btn.setAttribute("target", "_blank");
      const btnIcon = btn.createSpan({ cls: "evc-issue-link-icon" });
      setIcon(btnIcon, link.icon);
      btn.createSpan({ text: link.text });
    }

    // GitHub link - placed directly in header (right side, at logo level)
    const githubLink = header.createEl("a", {
      cls: "evc-settings-github-link",
      href: "https://github.com/entire-vc/evc-local-sync-plugin",
    });
    githubLink.setAttribute("target", "_blank");

    // Create GitHub icon using setIcon
    const iconSpan = githubLink.createSpan({ cls: "evc-github-icon" });
    setIcon(iconSpan, "github");

    githubLink.createSpan({ text: "GitHub" });
  }

  /**
   * Display General Settings section
   */
  private displayGeneralSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Sync").setHeading();

    // Sync Mode
    new Setting(containerEl)
      .setName("Sync mode")
      .setDesc("How synchronization is triggered")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("manual", "Manual only")
          .addOption("on-change", "On file change")
          .addOption("on-startup", "On Obsidian startup")
          .addOption("scheduled", "Scheduled interval")
          .setValue(this.plugin.settings.syncMode)
          .onChange(async (value) => {
            this.plugin.settings.syncMode = value as SyncMode;
            await this.plugin.saveSettings();
          })
      );

    // Sync on Startup
    new Setting(containerEl)
      .setName("Sync on startup")
      .setDesc("Automatically sync all enabled mappings when Obsidian starts")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.syncOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    // Debounce
    new Setting(containerEl)
      .setName("Debounce (ms)")
      .setDesc(
        "Delay before syncing after file changes (for on-change mode). Recommended: 2000-5000ms."
      )
      .addText((text) =>
        text
          .setPlaceholder("3000")
          .setValue(String(this.plugin.settings.debounceMs))
          .onChange(async (value) => {
            const numValue = parseInt(value, 10);
            if (!isNaN(numValue) && numValue >= 500 && numValue <= 30000) {
              this.plugin.settings.debounceMs = numValue;
              await this.plugin.saveSettings();
            }
          })
      );

    // Scheduled Interval
    new Setting(containerEl)
      .setName("Scheduled interval (minutes)")
      .setDesc(
        "How often to sync when using scheduled mode. Minimum: 1 minute."
      )
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.scheduledIntervalMinutes))
          .onChange(async (value) => {
            const numValue = parseInt(value, 10);
            if (!isNaN(numValue) && numValue >= 1 && numValue <= 1440) {
              this.plugin.settings.scheduledIntervalMinutes = numValue;
              await this.plugin.saveSettings();
            }
          })
      );

    // Conflict Resolution
    new Setting(containerEl)
      .setName("Conflict resolution")
      .setDesc("How to handle files modified in both locations")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("newer-wins", "Newer file wins")
          .addOption("always-ask", "Always ask")
          .addOption("ai-wins", "AI project wins")
          .addOption("obsidian-wins", "Obsidian wins")
          .setValue(this.plugin.settings.conflictResolution)
          .onChange(async (value) => {
            this.plugin.settings.conflictResolution =
              value as ConflictResolution;
            await this.plugin.saveSettings();
          })
      );

    // Create Backups
    new Setting(containerEl)
      .setName("Create backups")
      .setDesc("Create backup files before overwriting during sync")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.createBackups)
          .onChange(async (value) => {
            const wasEnabled = this.plugin.settings.createBackups;
            this.plugin.settings.createBackups = value;
            await this.plugin.saveSettings();

            // Offer to delete backups when disabling
            if (wasEnabled && !value) {
              this.offerBackupCleanup();
            }
          })
      );

    // Show Auto-Sync Notifications
    new Setting(containerEl)
      .setName("Show auto-sync notifications")
      .setDesc("Show notifications when files are auto-synced (on-change mode)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showAutoSyncNotifications)
          .onChange(async (value) => {
            this.plugin.settings.showAutoSyncNotifications = value;
            await this.plugin.saveSettings();
          })
      );

    // Follow Symlinks
    new Setting(containerEl)
      .setName("Follow symlinks")
      .setDesc("Follow symbolic links when scanning directories")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.followSymlinks)
          .onChange(async (value) => {
            this.plugin.settings.followSymlinks = value;
            await this.plugin.saveSettings();
          })
      );

    // Sync Deletions (FR-060)
    new Setting(containerEl)
      .setName("Sync deletions")
      .setDesc("When a file is deleted in one location, delete it in the other location too")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncDeletions)
          .onChange(async (value) => {
            this.plugin.settings.syncDeletions = value;
            await this.plugin.saveSettings();
          })
      );

    // Confirm Deletions (FR-060)
    new Setting(containerEl)
      .setName("Confirm deletions")
      .setDesc("Show confirmation before deleting files during sync")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.confirmDeletions)
          .onChange(async (value) => {
            this.plugin.settings.confirmDeletions = value;
            await this.plugin.saveSettings();
          })
      );

    // Log Retention
    new Setting(containerEl)
      .setName("Log retention (days)")
      .setDesc("How long to keep sync logs")
      .addText((text) =>
        text
          .setPlaceholder("7")
          .setValue(String(this.plugin.settings.logRetentionDays))
          .onChange(async (value) => {
            const numValue = parseInt(value, 10);
            if (!isNaN(numValue) && numValue >= 1 && numValue <= 365) {
              this.plugin.settings.logRetentionDays = numValue;
              await this.plugin.saveSettings();
            }
          })
      );
  }

  /**
   * Display File Types section
   */
  private displayFileTypesSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("File types").setHeading();

    // File Extensions
    new Setting(containerEl)
      .setName("File extensions")
      .setDesc("File types to sync (comma-separated, e.g., .md, .canvas)")
      .addText((text) =>
        text
          .setPlaceholder(".md, .canvas, .Excalidraw.md")
          .setValue(this.plugin.settings.fileTypes.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.fileTypes = value
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
          })
      );

    // Exclude Patterns
    new Setting(containerEl)
      .setName("Exclude patterns")
      .setDesc(
        "Folders/files to exclude from sync (comma-separated, e.g., node_modules, .git)"
      )
      .addText((text) =>
        text
          .setPlaceholder("Node_modules, .git")
          .setValue(this.plugin.settings.excludePatterns.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.excludePatterns = value
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
          })
      );
  }

  /**
   * Display Project Mappings section
   */
  private displayMappingsSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Project mappings").setHeading();

    // Add Mapping button
    new Setting(containerEl)
      .setName("Add project mapping")
      .setDesc("Create a new sync mapping between an AI project and Obsidian folder")
      .addButton((button) =>
        button
          .setButtonText("Add mapping")
          .setCta()
          .onClick(() => this.openAddMappingModal())
      );

    // Mappings container
    this.mappingsContainer = containerEl.createDiv({
      cls: "evc-mappings-container",
    });

    this.refreshMappingsTable();
  }

  /**
   * Refresh the mappings table display
   */
  private refreshMappingsTable(): void {
    if (!this.mappingsContainer) return;

    this.mappingsContainer.empty();

    const mappings = this.plugin.settings.mappings;

    if (mappings.length === 0) {
      this.mappingsContainer.createEl("p", {
        text: "No project mappings configured. Click 'add mapping' to create one.",
        cls: "evc-no-mappings",
      });
      return;
    }

    // Create table
    const table = this.mappingsContainer.createEl("table", {
      cls: "evc-mappings-table",
    });

    // Header
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: "Enabled" });
    headerRow.createEl("th", { text: "Name" });
    headerRow.createEl("th", { text: "AI path" });
    headerRow.createEl("th", { text: "Obsidian path" });
    headerRow.createEl("th", { text: "Direction" });
    headerRow.createEl("th", { text: "Actions" });

    // Body
    const tbody = table.createEl("tbody");

    for (const mapping of mappings) {
      const row = tbody.createEl("tr");
      row.addClass(mapping.syncEnabled ? "evc-mapping-enabled" : "evc-mapping-disabled");

      // Enabled toggle
      const enabledCell = row.createEl("td");
      const checkbox = enabledCell.createEl("input", { type: "checkbox" });
      checkbox.checked = mapping.syncEnabled;
      checkbox.addEventListener("change", () => {
        void this.plugin.mappingManager.toggleEnabled(mapping.id).then(() => {
          this.refreshMappingsTable();
        });
      });

      // Name (with custom settings indicator)
      const nameCell = row.createEl("td");
      nameCell.createEl("span", { text: mapping.name });

      // Show indicator if mapping has custom settings (FR-061, FR-062)
      if (hasCustomSettings(mapping)) {
        const indicator = nameCell.createEl("span", {
          text: " ⚙",
          cls: "evc-custom-settings-indicator",
        });
        const descriptions = getCustomSettingsDescription(mapping, this.plugin.settings);
        indicator.setAttribute("title", "Custom settings:\n" + descriptions.join("\n"));
      }

      // AI Path (truncated)
      const aiPathCell = row.createEl("td", { cls: "evc-path-cell" });
      aiPathCell.createEl("span", {
        text: this.truncatePath(mapping.aiPath),
        attr: { title: mapping.aiPath },
      });

      // Obsidian Path (truncated)
      const obsPathCell = row.createEl("td", { cls: "evc-path-cell" });
      obsPathCell.createEl("span", {
        text: this.truncatePath(mapping.obsidianPath),
        attr: { title: mapping.obsidianPath },
      });

      // Direction
      const directionText = mapping.bidirectional
        ? "Bidirectional"
        : mapping.syncDirection === "ai-to-obs"
        ? "AI -> Obs"
        : "Obs -> AI";
      row.createEl("td", { text: directionText });

      // Actions
      const actionsCell = row.createEl("td", { cls: "evc-actions-cell" });

      // Edit button
      const editBtn = actionsCell.createEl("button", {
        text: "Edit",
        cls: "evc-btn evc-btn-edit",
      });
      editBtn.addEventListener("click", () => this.openEditMappingModal(mapping));

      // Delete button
      const deleteBtn = actionsCell.createEl("button", {
        text: "Delete",
        cls: "evc-btn evc-btn-delete",
      });
      deleteBtn.addEventListener("click", () => {
        void showConfirmation(
          this.app,
          `Delete mapping "${mapping.name}"?`,
          "Delete"
        ).then(async (confirmed) => {
          if (confirmed) {
            await this.plugin.mappingManager.delete(mapping.id);
            this.refreshMappingsTable();
            new Notice(`Mapping "${mapping.name}" deleted`);
          }
        });
      });
    }
  }

  /**
   * Truncate path for display
   */
  private truncatePath(path: string, maxLen = 30): string {
    if (path.length <= maxLen) return path;
    return "..." + path.slice(-(maxLen - 3));
  }

  /**
   * Open modal to add a new mapping
   */
  private openAddMappingModal(): void {
    const modal = new MappingModal(this.app, {
      plugin: this.plugin,
      onSave: async (mapping) => {
        await this.plugin.mappingManager.add(mapping);
        this.refreshMappingsTable();
        new Notice(`Mapping "${mapping.name}" created`);
      },
    });
    modal.open();
  }

  /**
   * Open modal to edit an existing mapping
   */
  private openEditMappingModal(mapping: ProjectMapping): void {
    const modal = new MappingModal(this.app, {
      plugin: this.plugin,
      mapping,
      onSave: async (updatedMapping) => {
        await this.plugin.mappingManager.update(mapping.id, updatedMapping);
        this.refreshMappingsTable();
        new Notice(`Mapping "${updatedMapping.name}" updated`);
      },
    });
    modal.open();
  }

  /**
   * Display Actions section
   */
  private displayActionsSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Actions").setHeading();

    const actionsContainer = containerEl.createDiv({ cls: "evc-actions-container" });

    // Sync All button
    new Setting(actionsContainer)
      .setName("Sync all projects")
      .setDesc("Synchronize all enabled project mappings now")
      .addButton((button: ButtonComponent) =>
        button
          .setButtonText("Sync all")
          .setCta()
          .onClick(async () => {
            await this.plugin.syncAllProjects();
          })
      );

    // Dry Run button
    new Setting(actionsContainer)
      .setName("Dry run")
      .setDesc("Preview what would be synced without making changes")
      .addButton((button: ButtonComponent) =>
        button.setButtonText("Dry run").onClick(async () => {
          await this.plugin.dryRun();
        })
      );

    // View Logs button
    new Setting(actionsContainer)
      .setName("View logs")
      .setDesc("View recent sync log entries")
      .addButton((button: ButtonComponent) =>
        button.setButtonText("View logs").onClick(() => {
          this.plugin.viewLogs();
        })
      );

    // Configuration Management section
    new Setting(containerEl).setName("Configuration").setHeading();

    const configContainer = containerEl.createDiv({ cls: "evc-config-container" });

    // Export Configuration
    new Setting(configContainer)
      .setName("Export configuration")
      .setDesc("Export settings and mappings to a JSON file")
      .addButton((button: ButtonComponent) =>
        button.setButtonText("Export").onClick(() => {
          this.exportConfiguration();
        })
      );

    // Import Configuration
    new Setting(configContainer)
      .setName("Import configuration")
      .setDesc("Import settings and mappings from a JSON file")
      .addButton((button: ButtonComponent) =>
        button.setButtonText("Import").onClick(() => {
          this.importConfiguration();
        })
      );
  }

  /**
   * Export configuration to JSON file
   */
  private exportConfiguration(): void {
    const config = {
      version: this.plugin.settings.version,
      exportedAt: new Date().toISOString(),
      settings: {
        syncMode: this.plugin.settings.syncMode,
        syncOnStartup: this.plugin.settings.syncOnStartup,
        debounceMs: this.plugin.settings.debounceMs,
        scheduledIntervalMinutes: this.plugin.settings.scheduledIntervalMinutes,
        conflictResolution: this.plugin.settings.conflictResolution,
        createBackups: this.plugin.settings.createBackups,
        showAutoSyncNotifications: this.plugin.settings.showAutoSyncNotifications,
        followSymlinks: this.plugin.settings.followSymlinks,
        fileTypes: this.plugin.settings.fileTypes,
        excludePatterns: this.plugin.settings.excludePatterns,
        logRetentionDays: this.plugin.settings.logRetentionDays,
      },
      mappings: this.plugin.settings.mappings,
    };

    const jsonContent = JSON.stringify(config, null, 2);
    const blob = new Blob([jsonContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `evc-sync-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    new Notice("Configuration exported successfully");
  }

  /**
   * Import configuration from JSON file
   */
  private importConfiguration(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";

    input.addEventListener("change", (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      void file.text().then((content) => {
        const config = JSON.parse(content) as {
          settings?: Partial<EVCLocalSyncSettings>;
          mappings?: ProjectMapping[];
        };

        // Validate config structure
        if (!config.settings || !config.mappings) {
          throw new Error("Invalid configuration file format");
        }

        const importedSettings = config.settings;
        const importedMappings = config.mappings;

        // Confirm import
        return showConfirmation(
          this.app,
          "This will replace your current settings and mappings. Continue?",
          "Import"
        ).then((confirmed) => {
          if (!confirmed) {
            return;
          }

          // Apply settings
          const newSettings: EVCLocalSyncSettings = {
            ...this.plugin.settings,
            ...importedSettings,
            mappings: importedMappings,
          };

          this.plugin.settings = newSettings;
          return this.plugin.saveSettings().then(() => {
            new Notice(`Imported ${importedMappings.length} mapping(s) successfully`);

            // Refresh display
            this.display();
          });
        });
      }).catch((error: Error) => {
        new Notice(`Import failed: ${error.message}`);
      });
    });

    input.click();
  }

  /**
   * Offer to clean up backup files when backups are disabled
   */
  private offerBackupCleanup(): void {
    void showConfirmation(
      this.app,
      "Delete existing backup files? This will remove all .backup-* files in synced folders.",
      "Delete backups"
    ).then(async (shouldCleanup) => {
      if (!shouldCleanup) {
        return;
      }

      let deletedCount = 0;

      for (const mapping of this.plugin.settings.mappings) {
        // Clean up Obsidian backups
        const obsPath = mapping.obsidianPath;
        const obsFolder = this.app.vault.getAbstractFileByPath(obsPath);

        if (obsFolder) {
          const files = this.app.vault.getFiles();
          for (const file of files) {
            if (file.path.startsWith(obsPath) && file.path.includes(".backup-")) {
              await this.app.fileManager.trashFile(file);
              deletedCount++;
            }
          }
        }

        // Clean up AI project backups
        const aiPath = mapping.aiPath.replace(/^~/, process.env.HOME || "");

        if (fs.existsSync(aiPath)) {
          const walkAndDelete = (dir: string): void => {
            try {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  walkAndDelete(fullPath);
                } else if (entry.name.includes(".backup-")) {
                  fs.unlinkSync(fullPath);
                  deletedCount++;
                }
              }
            } catch {
              // Ignore errors
            }
          };
          walkAndDelete(aiPath);
        }
      }

      new Notice(`Deleted ${deletedCount} backup file(s)`);
    });
  }
}
