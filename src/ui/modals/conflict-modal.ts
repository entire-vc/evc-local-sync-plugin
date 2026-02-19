import { App, Modal } from "obsidian";
import type { ConflictInfo, ResolutionDecision } from "../../conflict-resolver";

/**
 * Modal for resolving file conflicts (FR-013)
 *
 * Shows when conflict resolution strategy is "always-ask":
 * - File path
 * - AI version info (modified time, size)
 * - Obsidian version info (modified time, size)
 * - Action buttons: Use AI Version / Use Obsidian Version / Skip
 */
export class ConflictModal extends Modal {
  private conflict: ConflictInfo;
  private onResolve: (decision: ResolutionDecision) => void;
  private resolvePromise: Promise<ResolutionDecision>;
  private resolveCallback: ((decision: ResolutionDecision) => void) | null = null;

  constructor(
    app: App,
    options: {
      conflict: ConflictInfo;
      onResolve: (decision: ResolutionDecision) => void;
    }
  ) {
    super(app);
    this.conflict = options.conflict;
    this.onResolve = options.onResolve;

    // Create a promise that will be resolved when user makes a choice
    this.resolvePromise = new Promise((resolve) => {
      this.resolveCallback = resolve;
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("evc-sync-modal", "evc-conflict-modal");

    // Title
    contentEl.createEl("h2", { text: "File conflict" });

    // Description
    contentEl.createEl("p", {
      text: "This file has been modified in both locations. Choose which version to keep:",
      cls: "evc-modal-description",
    });

    // File path
    this.renderFilePath(contentEl);

    // Version comparison
    this.renderVersionComparison(contentEl);

    // Action buttons
    this.renderActionButtons(contentEl);
  }

  /**
   * Render file path section
   */
  private renderFilePath(containerEl: HTMLElement): void {
    const pathEl = containerEl.createDiv({ cls: "evc-conflict-path" });
    pathEl.createEl("span", {
      text: "File: ",
      cls: "evc-conflict-path-label",
    });
    pathEl.createEl("code", {
      text: this.conflict.relativePath,
      cls: "evc-conflict-path-value",
    });
  }

  /**
   * Render version comparison section
   */
  private renderVersionComparison(containerEl: HTMLElement): void {
    const comparisonEl = containerEl.createDiv({ cls: "evc-conflict-comparison" });

    // AI Version
    const aiEl = comparisonEl.createDiv({ cls: "evc-conflict-version evc-conflict-version-ai" });
    aiEl.createEl("h4", { text: "AI project version" });
    this.renderVersionInfo(aiEl, {
      mtime: this.conflict.aiMtime,
      size: this.conflict.aiSize,
      path: this.conflict.aiPath,
    });

    // VS separator
    comparisonEl.createEl("div", {
      text: "VS",
      cls: "evc-conflict-vs",
    });

    // Obsidian Version
    const obsEl = comparisonEl.createDiv({ cls: "evc-conflict-version evc-conflict-version-obs" });
    obsEl.createEl("h4", { text: "Obsidian version" });
    this.renderVersionInfo(obsEl, {
      mtime: this.conflict.obsidianMtime,
      size: this.conflict.obsidianSize,
      path: this.conflict.obsidianPath,
    });

    // Determine newer version
    const aiTime = this.conflict.aiMtime instanceof Date
      ? this.conflict.aiMtime.getTime()
      : this.conflict.aiMtime;
    const obsTime = this.conflict.obsidianMtime instanceof Date
      ? this.conflict.obsidianMtime.getTime()
      : this.conflict.obsidianMtime;

    if (aiTime > obsTime) {
      aiEl.addClass("evc-conflict-version-newer");
      aiEl.createEl("span", {
        text: "(newer)",
        cls: "evc-conflict-newer-badge",
      });
    } else if (obsTime > aiTime) {
      obsEl.addClass("evc-conflict-version-newer");
      obsEl.createEl("span", {
        text: "(newer)",
        cls: "evc-conflict-newer-badge",
      });
    }
  }

  /**
   * Render version info details
   */
  private renderVersionInfo(
    containerEl: HTMLElement,
    info: { mtime: Date | number; size: number; path: string }
  ): void {
    const detailsEl = containerEl.createDiv({ cls: "evc-conflict-details" });

    // Modified time
    const mtime = info.mtime instanceof Date ? info.mtime : new Date(info.mtime);
    const mtimeRow = detailsEl.createDiv({ cls: "evc-conflict-detail-row" });
    mtimeRow.createEl("span", {
      text: "Modified:",
      cls: "evc-conflict-detail-label",
    });
    mtimeRow.createEl("span", {
      text: this.formatDateTime(mtime),
      cls: "evc-conflict-detail-value",
    });

    // Size
    const sizeRow = detailsEl.createDiv({ cls: "evc-conflict-detail-row" });
    sizeRow.createEl("span", {
      text: "Size:",
      cls: "evc-conflict-detail-label",
    });
    sizeRow.createEl("span", {
      text: this.formatFileSize(info.size),
      cls: "evc-conflict-detail-value",
    });

    // Path (truncated)
    const pathRow = detailsEl.createDiv({ cls: "evc-conflict-detail-row" });
    pathRow.createEl("span", {
      text: "Path:",
      cls: "evc-conflict-detail-label",
    });
    pathRow.createEl("span", {
      text: this.truncatePath(info.path),
      cls: "evc-conflict-detail-value evc-conflict-detail-path evc-cursor-help",
      attr: { title: info.path },
    });
  }

  /**
   * Render action buttons
   */
  private renderActionButtons(containerEl: HTMLElement): void {
    const buttonsEl = containerEl.createDiv({ cls: "evc-conflict-buttons" });

    // Use AI Version button
    const useAiBtn = buttonsEl.createEl("button", {
      text: "Use AI version",
      cls: "evc-btn evc-btn-ai",
    });
    useAiBtn.addEventListener("click", () => {
      this.handleDecision("use-ai");
    });

    // Use Obsidian Version button
    const useObsBtn = buttonsEl.createEl("button", {
      text: "Use Obsidian version",
      cls: "evc-btn evc-btn-obs",
    });
    useObsBtn.addEventListener("click", () => {
      this.handleDecision("use-obsidian");
    });

    // Skip button
    const skipBtn = buttonsEl.createEl("button", {
      text: "Skip",
      cls: "evc-btn",
    });
    skipBtn.addEventListener("click", () => {
      this.handleDecision("skip");
    });
  }

  /**
   * Handle user's decision
   */
  private handleDecision(decision: ResolutionDecision): void {
    this.onResolve(decision);
    if (this.resolveCallback) {
      this.resolveCallback(decision);
    }
    this.close();
  }

  /**
   * Wait for user's decision (for async flow)
   */
  async waitForDecision(): Promise<ResolutionDecision> {
    return this.resolvePromise;
  }

  /**
   * Format date/time for display
   */
  private formatDateTime(date: Date): string {
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  /**
   * Format file size for display
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";

    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);

    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  /**
   * Truncate path for display
   */
  private truncatePath(path: string, maxLen = 40): string {
    if (path.length <= maxLen) return path;
    return "..." + path.slice(-(maxLen - 3));
  }

  onClose(): void {
    // If modal is closed without a decision, treat as skip
    if (this.resolveCallback) {
      this.resolveCallback("skip");
    }
    this.contentEl.empty();
  }
}
