import {
  App,
  Modal,
  Setting,
  Notice,
  TextComponent,
  DropdownComponent,
  ToggleComponent,
  setIcon,
} from "obsidian";
import type { ProjectMapping, SyncDirection, ConflictResolution } from "../../settings";
import type EVCLocalSyncPlugin from "../../main";
import { FolderSuggestModal } from "../folder-suggest";

/**
 * Modal options
 */
interface MappingModalOptions {
  plugin: EVCLocalSyncPlugin;
  mapping?: ProjectMapping;
  onSave: (mapping: Omit<ProjectMapping, "id">) => Promise<void>;
}

/**
 * Modal for adding or editing a project mapping (FR-001, FR-004)
 */
export class MappingModal extends Modal {
  private plugin: EVCLocalSyncPlugin;
  private mapping: Omit<ProjectMapping, "id">;
  private isEdit: boolean;
  private onSave: (mapping: Omit<ProjectMapping, "id">) => Promise<void>;

  // Form components
  private nameInput: TextComponent;
  private aiPathInput: TextComponent;
  private obsidianPathInput: TextComponent;
  private docsSubdirInput: TextComponent;
  private syncEnabledToggle: ToggleComponent;
  private bidirectionalToggle: ToggleComponent;
  private syncDirectionDropdown: DropdownComponent;
  private directionSetting: Setting;

  // Advanced settings
  private advancedContainer: HTMLElement;
  private advancedExpanded = false;

  // Error display
  private errorContainer: HTMLElement;

  constructor(app: App, options: MappingModalOptions) {
    super(app);
    this.plugin = options.plugin;
    this.isEdit = !!options.mapping;
    this.onSave = options.onSave;

    // Initialize mapping data
    this.mapping = options.mapping
      ? { ...options.mapping }
      : {
          name: "",
          aiPath: "",
          obsidianPath: "",
          docsSubdir: "docs",
          syncEnabled: true,
          bidirectional: true,
          syncDirection: "ai-to-obs",
          conflictResolutionOverride: undefined,
          fileTypesOverride: undefined,
          excludePatternsOverride: undefined,
        };

    // Expand advanced settings if any override is set
    if (options.mapping) {
      this.advancedExpanded = !!(
        options.mapping.conflictResolutionOverride ||
        options.mapping.fileTypesOverride ||
        options.mapping.excludePatternsOverride
      );
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("evc-sync-modal", "evc-mapping-modal");

    // Title
    contentEl.createEl("h2", {
      text: this.isEdit ? "Edit project mapping" : "Add project mapping",
    });

    // Description
    contentEl.createEl("p", {
      text: "Configure synchronization between an AI project folder and an Obsidian folder.",
      cls: "evc-modal-description",
    });

    // Error container (hidden by default via CSS)
    this.errorContainer = contentEl.createDiv({ cls: "evc-error-container evc-hidden" });

    // Form fields
    this.createFormFields(contentEl);

    // Buttons
    this.createButtons(contentEl);
  }

  /**
   * Create form fields
   */
  private createFormFields(containerEl: HTMLElement): void {
    // Name
    new Setting(containerEl)
      .setName("Mapping name")
      .setDesc("A friendly name for this mapping (e.g., 'my project')")
      .addText((text) => {
        this.nameInput = text;
        text
          .setPlaceholder("My project")
          .setValue(this.mapping.name)
          .onChange((value) => {
            this.mapping.name = value;
          });
      });

    // AI Project Path
    new Setting(containerEl)
      .setName("AI project path")
      .setDesc(
        "Full path to the AI project folder (e.g., ~/DevProjects/my-project)"
      )
      .addText((text) => {
        this.aiPathInput = text;
        text
          .setPlaceholder("~/projects/my-project")
          .setValue(this.mapping.aiPath)
          .onChange((value) => {
            this.mapping.aiPath = value;
          });
        text.inputEl.addClass("evc-input-wide");
      });

    // Obsidian Folder Path
    new Setting(containerEl)
      .setName("Obsidian folder")
      .setDesc("Path within your Obsidian vault")
      .addText((text) => {
        this.obsidianPathInput = text;
        text
          .setPlaceholder("Projects/my-project")
          .setValue(this.mapping.obsidianPath)
          .onChange((value) => {
            this.mapping.obsidianPath = value;
          });
        text.inputEl.addClass("evc-input-wide");
      })
      .addExtraButton((button) => {
        button
          .setIcon("folder")
          .setTooltip("Browse folders")
          .onClick(() => {
            new FolderSuggestModal(this.app, (folder) => {
              const folderPath = folder.path === "/" ? "" : folder.path;
              this.obsidianPathInput.setValue(folderPath);
              this.mapping.obsidianPath = folderPath;
            }).open();
          });
      });

    // Docs Subdirectory
    new Setting(containerEl)
      .setName("Docs subdirectory")
      .setDesc(
        'Subdirectory for docs within both paths (e.g., "docs"). Leave empty to sync from root.'
      )
      .addText((text) => {
        this.docsSubdirInput = text;
        text
          .setPlaceholder("Docs")
          .setValue(this.mapping.docsSubdir)
          .onChange((value) => {
            this.mapping.docsSubdir = value;
          });
      });

    // Enable Sync toggle
    new Setting(containerEl)
      .setName("Enable sync")
      .setDesc("Whether this mapping is active for synchronization")
      .addToggle((toggle) => {
        this.syncEnabledToggle = toggle;
        toggle.setValue(this.mapping.syncEnabled).onChange((value) => {
          this.mapping.syncEnabled = value;
        });
      });

    // Bidirectional toggle
    new Setting(containerEl)
      .setName("Bidirectional sync")
      .setDesc("Sync in both directions (AI <-> Obsidian)")
      .addToggle((toggle) => {
        this.bidirectionalToggle = toggle;
        toggle.setValue(this.mapping.bidirectional).onChange((value) => {
          this.mapping.bidirectional = value;
          this.updateDirectionVisibility();
        });
      });

    // Sync Direction (shown only if not bidirectional)
    this.directionSetting = new Setting(containerEl)
      .setName("Sync direction")
      .setDesc("Direction to sync files (when not bidirectional)")
      .addDropdown((dropdown) => {
        this.syncDirectionDropdown = dropdown;
        dropdown
          .addOption("ai-to-obs", "AI project -> Obsidian")
          .addOption("obs-to-ai", "Obsidian -> AI project")
          .setValue(this.mapping.syncDirection || "ai-to-obs")
          .onChange((value) => {
            this.mapping.syncDirection = value as SyncDirection;
          });
      });

    this.updateDirectionVisibility();

    // Advanced settings section (FR-061, FR-062)
    this.createAdvancedSettings(containerEl);
  }

  /**
   * Create advanced settings section (collapsible)
   */
  private createAdvancedSettings(containerEl: HTMLElement): void {
    // Header
    const headerEl = containerEl.createDiv({ cls: "evc-advanced-header" });

    const toggleIcon = headerEl.createSpan({ cls: "evc-advanced-toggle-icon" });
    setIcon(toggleIcon, this.advancedExpanded ? "chevron-down" : "chevron-right");

    headerEl.createSpan({ text: "Advanced settings", cls: "evc-advanced-title" });

    // Content container
    this.advancedContainer = containerEl.createDiv({ cls: "evc-advanced-content" });
    if (!this.advancedExpanded) {
      this.advancedContainer.addClass("evc-hidden");
    }

    // Toggle handler
    headerEl.addEventListener("click", () => {
      this.advancedExpanded = !this.advancedExpanded;
      setIcon(toggleIcon, this.advancedExpanded ? "chevron-down" : "chevron-right");
      if (this.advancedExpanded) {
        this.advancedContainer.removeClass("evc-hidden");
      } else {
        this.advancedContainer.addClass("evc-hidden");
      }
    });

    // Conflict Resolution Override
    const globalConflict = this.plugin.settings.conflictResolution;
    const conflictLabels: Record<string, string> = {
      "newer-wins": "Newer file wins",
      "always-ask": "Always ask",
      "ai-wins": "AI project wins",
      "obsidian-wins": "Obsidian wins",
    };

    new Setting(this.advancedContainer)
      .setName("Conflict resolution")
      .setDesc(`Override global setting (current: ${conflictLabels[globalConflict]})`)
      .addDropdown((dropdown) => {
        dropdown
          .addOption("", `Use global (${conflictLabels[globalConflict]})`)
          .addOption("newer-wins", "Newer file wins")
          .addOption("always-ask", "Always ask")
          .addOption("ai-wins", "AI project wins")
          .addOption("obsidian-wins", "Obsidian wins")
          .setValue(this.mapping.conflictResolutionOverride || "")
          .onChange((value) => {
            this.mapping.conflictResolutionOverride = value ? value as ConflictResolution : undefined;
          });
      });

    // File Types Override
    const globalFileTypes = this.plugin.settings.fileTypes.join(", ");

    new Setting(this.advancedContainer)
      .setName("File types")
      .setDesc(`Override global file types (current: ${globalFileTypes})`)
      .addText((text) => {
        text
          .setPlaceholder(`Use global (${globalFileTypes})`)
          .setValue(this.mapping.fileTypesOverride?.join(", ") || "")
          .onChange((value) => {
            if (value.trim()) {
              this.mapping.fileTypesOverride = value
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            } else {
              this.mapping.fileTypesOverride = undefined;
            }
          });
        text.inputEl.addClass("evc-input-wide");
      });

    // Exclude Patterns Override
    const globalExclude = this.plugin.settings.excludePatterns.join(", ");

    new Setting(this.advancedContainer)
      .setName("Exclude patterns")
      .setDesc(`Override global exclusions (current: ${globalExclude})`)
      .addText((text) => {
        text
          .setPlaceholder(`Use global (${globalExclude})`)
          .setValue(this.mapping.excludePatternsOverride?.join(", ") || "")
          .onChange((value) => {
            if (value.trim()) {
              this.mapping.excludePatternsOverride = value
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            } else {
              this.mapping.excludePatternsOverride = undefined;
            }
          });
        text.inputEl.addClass("evc-input-wide");
      });
  }

  /**
   * Update visibility of sync direction based on bidirectional toggle
   */
  private updateDirectionVisibility(): void {
    const settingEl = this.directionSetting?.settingEl;
    if (settingEl) {
      if (this.mapping.bidirectional) {
        settingEl.addClass("evc-hidden");
      } else {
        settingEl.removeClass("evc-hidden");
      }
    }
  }

  /**
   * Create action buttons
   */
  private createButtons(containerEl: HTMLElement): void {
    const buttonContainer = containerEl.createDiv({ cls: "evc-modal-buttons" });

    // Cancel button
    const cancelBtn = buttonContainer.createEl("button", {
      text: "Cancel",
      cls: "evc-btn",
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    // Save button
    const saveBtn = buttonContainer.createEl("button", {
      text: this.isEdit ? "Save changes" : "Add mapping",
      cls: "evc-btn evc-btn-cta mod-cta",
    });
    saveBtn.addEventListener("click", () => {
      void this.handleSave();
    });
  }

  /**
   * Handle save action
   */
  private async handleSave(): Promise<void> {
    // Clear previous errors
    this.hideError();

    // Basic validation
    const errors: string[] = [];

    if (!this.mapping.name.trim()) {
      errors.push("Mapping name is required");
    }

    if (!this.mapping.aiPath.trim()) {
      errors.push("AI project path is required");
    }

    if (!this.mapping.obsidianPath.trim()) {
      errors.push("Obsidian folder path is required");
    }

    if (!this.mapping.bidirectional && !this.mapping.syncDirection) {
      errors.push("Sync direction is required for unidirectional sync");
    }

    if (errors.length > 0) {
      this.showError(errors.join("\n"));
      return;
    }

    // Validate paths using MappingManager
    try {
      const validation = this.plugin.mappingManager.validate(this.mapping);

      if (!validation.valid) {
        this.showError(validation.errors.join("\n"));
        return;
      }

      // Show warnings but don't block
      if (validation.warnings.length > 0) {
        new Notice(`Warnings:\n${validation.warnings.join("\n")}`, 5000);
      }

      // Call onSave callback
      await this.onSave(this.mapping);
      this.close();
    } catch (error) {
      this.showError((error as Error).message);
    }
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    this.errorContainer.empty();
    this.errorContainer.removeClass("evc-hidden");

    const errorIcon = this.errorContainer.createSpan({ cls: "evc-error-icon" });
    errorIcon.textContent = "!";

    const errorText = this.errorContainer.createSpan({ cls: "evc-error-text" });
    errorText.textContent = message;
  }

  /**
   * Hide error message
   */
  private hideError(): void {
    this.errorContainer.addClass("evc-hidden");
    this.errorContainer.empty();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
