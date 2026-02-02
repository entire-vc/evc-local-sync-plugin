import { App, FuzzySuggestModal, TFolder } from "obsidian";

/**
 * Modal for selecting a folder from the vault
 */
export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  private onChoose: (folder: TFolder) => void;

  constructor(app: App, onChoose: (folder: TFolder) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Select a folder...");
  }

  getItems(): TFolder[] {
    const folders: TFolder[] = [];

    // Get root folder
    const rootFolder = this.app.vault.getRoot();
    folders.push(rootFolder);

    // Recursively get all folders
    const getAllFolders = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          // Skip .obsidian and other hidden folders
          if (!child.name.startsWith(".")) {
            folders.push(child);
            getAllFolders(child);
          }
        }
      }
    };

    getAllFolders(rootFolder);

    return folders;
  }

  getItemText(folder: TFolder): string {
    if (folder.path === "/") {
      return "/ (vault root)";
    }
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onChoose(folder);
  }
}
