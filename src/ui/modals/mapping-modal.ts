import {
  App,
  Modal,
  Setting,
  Notice,
  TextComponent,
  DropdownComponent,
  ToggleComponent,
} from "obsidian";
import type { ProjectMapping, SyncDirection } from "../../settings";
import type EVCLocalSyncPlugin from "../../main";

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
        };
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
      .setDesc("A friendly name for this mapping (e.g., 'My project')")
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
          .setPlaceholder("~/DevProjects/my-project")
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
          .setPlaceholder("docs")
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
