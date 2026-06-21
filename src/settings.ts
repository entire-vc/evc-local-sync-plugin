import { App, PluginSettingTab, Setting, Notice, ButtonComponent } from "obsidian";
import type EVCLocalSyncPlugin from "./main";
import { MappingModal } from "./ui/modals/mapping-modal";
import { showConfirmation } from "./ui/modals/confirmation-modal";
import { EVC_LOGO_BASE64 } from "./logo";
import { hasCustomSettings, getCustomSettingsDescription } from "./sync-state-manager";
import { expandHome } from "./path-utils";
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

  private displayHeader(containerEl: HTMLElement): void {
    const header = containerEl.createDiv({ cls: "evc-settings-header" });

    // Top row: logo + title/desc + ghost icon buttons
    const top = header.createDiv({ cls: "evc-header-top" });

    top.createEl("img", {
      attr: { src: EVC_LOGO_BASE64, alt: "EVC", width: "32", height: "32" },
      cls: "evc-header-logo",
    });

    const text = top.createDiv({ cls: "evc-header-text" });
    text.createDiv({ text: "Local sync to AI agent", cls: "evc-header-title" });
    text.createDiv({ text: "Bidirectional sync between Obsidian and AI development projects", cls: "evc-header-desc" });

    const actions = top.createDiv({ cls: "evc-header-actions" });
    const ghostLinks: Array<{ href: string; title: string; svg: string }> = [
      {
        href: "https://github.com/entire-vc/evc-local-sync-plugin?utm_source=obsidian-plugin&utm_medium=plugin-header&utm_campaign=localsync&utm_content=github",
        title: "GitHub",
        svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 4 5 4 5 4c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 11c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>',
      },
      {
        href: "https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=bug-report.yml&utm_source=obsidian-plugin&utm_medium=plugin-header&utm_campaign=localsync&utm_content=bug",
        title: "Bug report",
        svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>',
      },
      {
        href: "https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=feature-request.yml&utm_source=obsidian-plugin&utm_medium=plugin-header&utm_campaign=localsync&utm_content=feature",
        title: "Feature request",
        svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
      },
      {
        href: "https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=conflict-case.yml&utm_source=obsidian-plugin&utm_medium=plugin-header&utm_campaign=localsync&utm_content=conflict",
        title: "Conflict case",
        svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
      },
    ];
    for (const { href, title, svg } of ghostLinks) {
      const a = actions.createEl("a", { cls: "evc-ghost-btn", href, attr: { target: "_blank", rel: "noopener", title } });
      a.innerHTML = svg;
    }

    // CTA row: Team Relay + Starter pack
    const ctas = header.createDiv({ cls: "evc-header-ctas" });

    const teamRelayBtn = ctas.createEl("a", {
      cls: "evc-prim-btn",
      href: "https://entire.vc/team-relay/?utm_source=obsidian-plugin&utm_medium=plugin-header&utm_campaign=localsync&utm_content=team-relay",
      attr: { target: "_blank", rel: "noopener" },
    });
    teamRelayBtn.insertAdjacentHTML("afterbegin", '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>');
    teamRelayBtn.createSpan({ text: "Team Relay" });

    const starterBtn = ctas.createEl("a", {
      cls: "evc-prim-btn",
      href: "https://entire.vc/local-sync/?utm_source=obsidian-plugin&utm_medium=plugin-header&utm_campaign=localsync&utm_content=starterpack#starterpack",
      attr: { target: "_blank", rel: "noopener" },
    });
    starterBtn.insertAdjacentHTML("afterbegin", '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>');
    starterBtn.createSpan({ text: "Starter pack" });

    ctas.createSpan({ text: "Extended for teams →", cls: "evc-header-cta-hint" });
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
          .setPlaceholder("Folders to exclude")
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
      nameCell.createSpan({ text: mapping.name });

      // Show indicator if mapping has custom settings (FR-061, FR-062)
      if (hasCustomSettings(mapping)) {
        const indicator = nameCell.createSpan({
          text: " ⚙",
          cls: "evc-custom-settings-indicator",
        });
        const descriptions = getCustomSettingsDescription(mapping, this.plugin.settings);
        indicator.setAttribute("title", "Custom settings:\n" + descriptions.join("\n"));
      }

      // AI Path (truncated)
      const aiPathCell = row.createEl("td", { cls: "evc-path-cell" });
      aiPathCell.createSpan({
        text: this.truncatePath(mapping.aiPath),
        attr: { title: mapping.aiPath },
      });

      // Obsidian Path (truncated)
      const obsPathCell = row.createEl("td", { cls: "evc-path-cell" });
      obsPathCell.createSpan({
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

    const link = activeDocument.createElement("a");
    link.href = url;
    link.download = `evc-sync-config-${new Date().toISOString().slice(0, 10)}.json`;
    activeDocument.body.appendChild(link);
    link.click();
    activeDocument.body.removeChild(link);
    URL.revokeObjectURL(url);

    new Notice("Configuration exported successfully");
  }

  /**
   * Import configuration from JSON file
   */
  private importConfiguration(): void {
    const input = activeDocument.createElement("input");
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
        const aiPath = expandHome(mapping.aiPath);

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
