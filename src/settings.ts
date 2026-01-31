import { App, PluginSettingTab, Setting, Notice, ButtonComponent, setIcon } from "obsidian";
import type EVCLocalSyncPlugin from "./main";
import { MappingModal } from "./ui/modals/mapping-modal";
import { showConfirmation } from "./ui/modals/confirmation-modal";
import { EVC_LOGO_BASE64 } from "./logo";
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
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: EVCLocalSyncSettings = {
  version: "1.0",
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
    ".obsidian",
    ".DS_Store",
    ".space",
  ],
  mappings: [],
  logRetentionDays: 7,
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
    const logoImg = iconContainer.createEl("img", {
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
    infoContainer.createEl("div", { text: "EVC Local Sync to AI Agent", cls: "evc-settings-title" });

    // Description
    infoContainer.createEl("p", {
      text: "Bidirectional sync between Obsidian and AI development projects",
      cls: "evc-settings-description",
    });

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
    new Setting(containerEl).setName("General settings").setHeading();

    // Sync Mode
    new Setting(containerEl)
      .setName("Sync Mode")
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
      .setName("Sync on Startup")
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
      .setName("Scheduled Interval (minutes)")
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
      .setName("Conflict Resolution")
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
      .setName("Create Backups")
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
      .setName("Show Auto-Sync Notifications")
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
      .setName("Follow Symlinks")
      .setDesc("Follow symbolic links when scanning directories")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.followSymlinks)
          .onChange(async (value) => {
            this.plugin.settings.followSymlinks = value;
            await this.plugin.saveSettings();
          })
      );

    // Log Retention
    new Setting(containerEl)
      .setName("Log Retention (days)")
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
      .setName("File Extensions")
      .setDesc("File types to sync (comma-separated, e.g., .md, .canvas)")
      .addText((text) =>
        text
          .setPlaceholder(".md, .canvas, .excalidraw.md")
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
      .setName("Exclude Patterns")
      .setDesc(
        "Folders/files to exclude from sync (comma-separated, e.g., node_modules, .git)"
      )
      .addText((text) =>
        text
          .setPlaceholder("node_modules, .git, .obsidian")
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
      .setName("Add Project Mapping")
      .setDesc("Create a new sync mapping between an AI project and Obsidian folder")
      .addButton((button) =>
        button
          .setButtonText("Add Mapping")
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
        text: "No project mappings configured. Click 'Add Mapping' to create one.",
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
    headerRow.createEl("th", { text: "AI Path" });
    headerRow.createEl("th", { text: "Obsidian Path" });
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
      checkbox.addEventListener("change", async () => {
        await this.plugin.mappingManager.toggleEnabled(mapping.id);
        this.refreshMappingsTable();
      });

      // Name
      row.createEl("td", { text: mapping.name });

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
      .setName("Sync All Projects")
      .setDesc("Synchronize all enabled project mappings now")
      .addButton((button: ButtonComponent) =>
        button
          .setButtonText("Sync All")
          .setCta()
          .onClick(async () => {
            await this.plugin.syncAllProjects();
          })
      );

    // Dry Run button
    new Setting(actionsContainer)
      .setName("Dry Run")
      .setDesc("Preview what would be synced without making changes")
      .addButton((button: ButtonComponent) =>
        button.setButtonText("Dry Run").onClick(async () => {
          await this.plugin.dryRun();
        })
      );

    // View Logs button
    new Setting(actionsContainer)
      .setName("View Logs")
      .setDesc("View recent sync log entries")
      .addButton((button: ButtonComponent) =>
        button.setButtonText("View Logs").onClick(() => {
          this.plugin.viewLogs();
        })
      );

    // Configuration Management section
    new Setting(containerEl).setName("Configuration").setHeading();

    const configContainer = containerEl.createDiv({ cls: "evc-config-container" });

    // Export Configuration
    new Setting(configContainer)
      .setName("Export Configuration")
      .setDesc("Export settings and mappings to a JSON file")
      .addButton((button: ButtonComponent) =>
        button.setButtonText("Export").onClick(() => {
          this.exportConfiguration();
        })
      );

    // Import Configuration
    new Setting(configContainer)
      .setName("Import Configuration")
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

    input.addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const content = await file.text();
        const config = JSON.parse(content);

        // Validate config structure
        if (!config.settings || !config.mappings) {
          throw new Error("Invalid configuration file format");
        }

        // Confirm import
        const confirmed = await showConfirmation(
          this.app,
          "This will replace your current settings and mappings. Continue?",
          "Import"
        );
        if (!confirmed) {
          return;
        }

        // Apply settings
        const newSettings = {
          ...this.plugin.settings,
          ...config.settings,
          mappings: config.mappings,
        };

        this.plugin.settings = newSettings;
        await this.plugin.saveSettings();

        new Notice(`Imported ${config.mappings.length} mapping(s) successfully`);

        // Refresh display
        this.display();
      } catch (error) {
        new Notice(`Import failed: ${(error as Error).message}`);
      }
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
              await this.app.vault.delete(file);
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
