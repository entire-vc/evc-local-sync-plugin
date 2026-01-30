import {
  App,
  Modal,
  Setting,
  Notice,
  TextComponent,
  DropdownComponent,
  ToggleComponent,
  TFolder,
  FuzzySuggestModal,
} from "obsidian";
import type { ProjectMapping, SyncDirection } from "../../settings";
import type EVCLocalSyncPlugin from "../../main";

/**
 * Folder suggester modal for Obsidian paths
 */
class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  private folders: TFolder[];
  private onChoose: (folder: TFolder) => void;

  constructor(app: App, folders: TFolder[], onChoose: (folder: TFolder) => void) {
    super(app);
    this.folders = folders;
    this.onChoose = onChoose;
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(item: TFolder): string {
    return item.path;
  }

  onChooseItem(item: TFolder): void {
    this.onChoose(item);
  }
}

/**
 * Get all folders in the vault
 */
function getAllFolders(app: App): TFolder[] {
  const folders: TFolder[] = [];
  const rootFolder = app.vault.getRoot();

  function collectFolders(folder: TFolder): void {
    folders.push(folder);
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        collectFolders(child);
      }
    }
  }

  collectFolders(rootFolder);
  return folders;
}

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
      text: this.isEdit ? "Edit Project Mapping" : "Add Project Mapping",
    });

    // Description
    contentEl.createEl("p", {
      text: "Configure synchronization between an AI project folder and an Obsidian folder.",
      cls: "evc-modal-description",
    });

    // Error container
    this.errorContainer = contentEl.createDiv({ cls: "evc-error-container" });
    this.errorContainer.style.display = "none";

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
      .setName("Mapping Name")
      .setDesc("A friendly name for this mapping (e.g., 'My Project')")
      .addText((text) => {
        this.nameInput = text;
        text
          .setPlaceholder("My Project")
          .setValue(this.mapping.name)
          .onChange((value) => {
            this.mapping.name = value;
          });
      });

    // AI Project Path
    const aiPathSetting = new Setting(containerEl)
      .setName("AI Project Path")
      .setDesc(
        "Full path to the AI project folder (e.g., ~/DevProjects/my-project)"
      );

    aiPathSetting.addText((text) => {
      this.aiPathInput = text;
      text
        .setPlaceholder("~/DevProjects/my-project")
        .setValue(this.mapping.aiPath)
        .onChange((value) => {
          this.mapping.aiPath = value;
        });
      text.inputEl.style.width = "250px";
    });

    // Add folder picker button for AI path
    aiPathSetting.addButton((button) => {
      button
        .setIcon("folder")
        .setTooltip("Browse folders")
        .onClick(async () => {
          await this.openFolderPicker();
        });
    });

    // Obsidian Folder Path
    const obsPathSetting = new Setting(containerEl)
      .setName("Obsidian Folder")
      .setDesc("Path within your Obsidian vault");

    obsPathSetting.addText((text) => {
      this.obsidianPathInput = text;
      text
        .setPlaceholder("Projects/MyProject")
        .setValue(this.mapping.obsidianPath)
        .onChange((value) => {
          this.mapping.obsidianPath = value;
        });
      text.inputEl.style.width = "250px";
    });

    // Add folder suggester button
    obsPathSetting.addButton((button) => {
      button
        .setIcon("folder")
        .setTooltip("Browse folders")
        .onClick(() => {
          const folders = getAllFolders(this.app);
          const modal = new FolderSuggestModal(this.app, folders, (folder) => {
            this.mapping.obsidianPath = folder.path;
            this.obsidianPathInput.setValue(folder.path);
          });
          modal.open();
        });
    });

    // Docs Subdirectory
    new Setting(containerEl)
      .setName("Docs Subdirectory")
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
      .setName("Enable Sync")
      .setDesc("Whether this mapping is active for synchronization")
      .addToggle((toggle) => {
        this.syncEnabledToggle = toggle;
        toggle.setValue(this.mapping.syncEnabled).onChange((value) => {
          this.mapping.syncEnabled = value;
        });
      });

    // Bidirectional toggle
    new Setting(containerEl)
      .setName("Bidirectional Sync")
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
      .setName("Sync Direction")
      .setDesc("Direction to sync files (when not bidirectional)")
      .addDropdown((dropdown) => {
        this.syncDirectionDropdown = dropdown;
        dropdown
          .addOption("ai-to-obs", "AI Project -> Obsidian")
          .addOption("obs-to-ai", "Obsidian -> AI Project")
          .setValue(this.mapping.syncDirection || "ai-to-obs")
          .onChange((value) => {
            this.mapping.syncDirection = value as SyncDirection;
          });
      });

    this.updateDirectionVisibility();
  }

  /**
   * Open system folder picker dialog for AI project path
   */
  private async openFolderPicker(): Promise<void> {
    try {
      // In Obsidian, we need to access Electron's dialog via require
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { remote } = require("@electron/remote") as typeof import("@electron/remote");

      const result = await remote.dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Select AI Project Folder",
      });

      if (!result.canceled && result.filePaths.length > 0) {
        this.mapping.aiPath = result.filePaths[0];
        this.aiPathInput.setValue(result.filePaths[0]);
      }
    } catch {
      // Fallback: Try alternative Electron access methods
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
        const electron = require("electron") as any;
        const dialog = electron.remote?.dialog;

        if (dialog) {
          const result = await dialog.showOpenDialog({
            properties: ["openDirectory"],
            title: "Select AI Project Folder",
          });

          if (!result.canceled && result.filePaths.length > 0) {
            this.mapping.aiPath = result.filePaths[0];
            this.aiPathInput.setValue(result.filePaths[0]);
          }
        } else {
          new Notice("Folder picker is not available. Please enter the path manually.");
        }
      } catch {
        new Notice("Folder picker is not available. Please enter the path manually.");
      }
    }
  }

  /**
   * Update visibility of sync direction based on bidirectional toggle
   */
  private updateDirectionVisibility(): void {
    if (this.directionSetting && this.directionSetting.settingEl) {
      this.directionSetting.settingEl.style.display = this.mapping.bidirectional
        ? "none"
        : "flex";
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
      text: this.isEdit ? "Save Changes" : "Add Mapping",
      cls: "evc-btn evc-btn-cta mod-cta",
    });
    saveBtn.addEventListener("click", async () => {
      await this.handleSave();
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
      const validation = await this.plugin.mappingManager.validate(this.mapping);

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
    this.errorContainer.style.display = "block";

    const errorIcon = this.errorContainer.createSpan({ cls: "evc-error-icon" });
    errorIcon.textContent = "!";

    const errorText = this.errorContainer.createSpan({ cls: "evc-error-text" });
    errorText.textContent = message;
  }

  /**
   * Hide error message
   */
  private hideError(): void {
    this.errorContainer.style.display = "none";
    this.errorContainer.empty();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
