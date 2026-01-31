import { App, Modal, Notice } from "obsidian";
import type { DryRunResult, PlannedSyncAction } from "../../sync-engine";

/**
 * Group of actions for a single mapping
 */
interface ActionGroup {
  toObsidian: PlannedSyncAction[];
  toAi: PlannedSyncAction[];
  skipped: PlannedSyncAction[];
}

/**
 * Modal for displaying dry-run results (FR-014)
 *
 * Shows planned sync changes without executing them:
 * - Files to copy/update to Obsidian
 * - Files to copy/update to AI project
 * - Files that will be skipped
 * - Execute sync / Close buttons
 */
export class DryRunModal extends Modal {
  private results: DryRunResult[];
  private onConfirm: () => Promise<void>;

  constructor(
    app: App,
    options: {
      results: DryRunResult[];
      onConfirm: () => Promise<void>;
    }
  ) {
    super(app);
    this.results = options.results;
    this.onConfirm = options.onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("evc-sync-modal", "evc-dry-run-modal");

    // Title
    contentEl.createEl("h2", { text: "Sync preview" });

    const totalActions = this.getTotalActions();
    const totalErrors = this.getTotalErrors();

    // Summary
    if (totalActions === 0 && totalErrors === 0) {
      this.renderNoChanges(contentEl);
    } else {
      this.renderSummary(contentEl, totalActions, totalErrors);
      this.renderResults(contentEl);
    }

    // Buttons
    this.renderButtons(contentEl, totalActions);
  }

  /**
   * Render "no changes" message
   */
  private renderNoChanges(containerEl: HTMLElement): void {
    const noChangesEl = containerEl.createDiv({ cls: "evc-dry-run-no-changes" });
    noChangesEl.createEl("div", {
      text: "All files are in sync!",
      cls: "evc-dry-run-no-changes-title",
    });
    noChangesEl.createEl("div", {
      text: "No changes would be made.",
      cls: "evc-dry-run-no-changes-subtitle",
    });
  }

  /**
   * Render summary section
   */
  private renderSummary(
    containerEl: HTMLElement,
    totalActions: number,
    totalErrors: number
  ): void {
    const summaryEl = containerEl.createDiv({ cls: "evc-dry-run-summary" });

    // Count by action type
    let copyCount = 0;
    let updateCount = 0;
    let skipCount = 0;

    for (const result of this.results) {
      for (const action of result.plannedActions) {
        if (action.action === "copy") copyCount++;
        else if (action.action === "update") updateCount++;
        else if (action.action === "skip") skipCount++;
      }
    }

    summaryEl.createEl("span", {
      text: `${totalActions} action(s) planned: `,
      cls: "evc-dry-run-summary-text",
    });

    if (copyCount > 0) {
      summaryEl.createEl("span", {
        text: `${copyCount} copy`,
        cls: "evc-dry-run-badge evc-dry-run-badge-copy",
      });
    }
    if (updateCount > 0) {
      summaryEl.createEl("span", {
        text: `${updateCount} update`,
        cls: "evc-dry-run-badge evc-dry-run-badge-update",
      });
    }
    if (skipCount > 0) {
      summaryEl.createEl("span", {
        text: `${skipCount} skip`,
        cls: "evc-dry-run-badge evc-dry-run-badge-skip",
      });
    }

    if (totalErrors > 0) {
      summaryEl.createEl("span", {
        text: `${totalErrors} error(s)`,
        cls: "evc-dry-run-badge evc-dry-run-badge-error",
      });
    }
  }

  /**
   * Render results by mapping
   */
  private renderResults(containerEl: HTMLElement): void {
    const resultsEl = containerEl.createDiv({ cls: "evc-dry-run-results" });

    for (const result of this.results) {
      // Skip mappings with no actions and no errors
      if (result.plannedActions.length === 0 && result.errors.length === 0) {
        continue;
      }

      this.renderMappingSection(resultsEl, result);
    }
  }

  /**
   * Render section for a single mapping
   */
  private renderMappingSection(
    containerEl: HTMLElement,
    result: DryRunResult
  ): void {
    const sectionEl = containerEl.createDiv({ cls: "evc-dry-run-section" });

    // Section header
    sectionEl.createEl("h3", {
      text: result.mapping.name,
      cls: "evc-dry-run-section-title",
    });

    // Render errors if any
    if (result.errors.length > 0) {
      const errorsEl = sectionEl.createDiv({ cls: "evc-dry-run-errors" });
      errorsEl.createEl("div", {
        text: "Errors:",
        cls: "evc-dry-run-group-title evc-dry-run-group-title-error",
      });
      for (const error of result.errors) {
        errorsEl.createEl("div", {
          text: error,
          cls: "evc-dry-run-error-item",
        });
      }
    }

    // Group actions by direction
    const groups = this.groupActions(result.plannedActions);

    // To Obsidian
    if (groups.toObsidian.length > 0) {
      this.renderActionGroup(
        sectionEl,
        "To Obsidian:",
        groups.toObsidian,
        "ai-to-obs"
      );
    }

    // To AI Project
    if (groups.toAi.length > 0) {
      this.renderActionGroup(
        sectionEl,
        "To AI Project:",
        groups.toAi,
        "obs-to-ai"
      );
    }

    // Skipped (collapsible)
    if (groups.skipped.length > 0) {
      this.renderSkippedGroup(sectionEl, groups.skipped);
    }
  }

  /**
   * Group actions by direction
   */
  private groupActions(actions: PlannedSyncAction[]): ActionGroup {
    const groups: ActionGroup = {
      toObsidian: [],
      toAi: [],
      skipped: [],
    };

    for (const action of actions) {
      if (action.action === "skip") {
        groups.skipped.push(action);
      } else if (action.direction === "ai-to-obs") {
        groups.toObsidian.push(action);
      } else {
        groups.toAi.push(action);
      }
    }

    return groups;
  }

  /**
   * Render action group (To Obsidian / To AI)
   */
  private renderActionGroup(
    containerEl: HTMLElement,
    title: string,
    actions: PlannedSyncAction[],
    direction: "ai-to-obs" | "obs-to-ai"
  ): void {
    const groupEl = containerEl.createDiv({ cls: "evc-dry-run-group" });

    const titleCls =
      direction === "ai-to-obs"
        ? "evc-dry-run-group-title-obsidian"
        : "evc-dry-run-group-title-ai";

    groupEl.createEl("div", {
      text: title,
      cls: `evc-dry-run-group-title ${titleCls}`,
    });

    const listEl = groupEl.createEl("ul", { cls: "evc-dry-run-list" });

    for (const action of actions) {
      const itemEl = listEl.createEl("li", {
        cls: `evc-dry-run-item evc-dry-run-item-${action.action}`,
      });

      // Action icon
      const iconText = action.action === "copy" ? "+" : "*";
      itemEl.createEl("span", {
        text: iconText,
        cls: `evc-dry-run-icon evc-dry-run-icon-${action.action}`,
      });

      // File name
      itemEl.createEl("span", {
        text: action.file,
        cls: "evc-dry-run-filename",
      });

      // Reason
      itemEl.createEl("span", {
        text: `(${action.reason})`,
        cls: "evc-dry-run-reason",
      });
    }
  }

  /**
   * Render skipped files group (collapsible)
   */
  private renderSkippedGroup(
    containerEl: HTMLElement,
    actions: PlannedSyncAction[]
  ): void {
    const groupEl = containerEl.createDiv({ cls: "evc-dry-run-group evc-dry-run-group-skipped" });

    // Collapsible header
    const headerEl = groupEl.createEl("div", {
      cls: "evc-dry-run-group-title evc-dry-run-group-title-skip evc-collapsible-header",
    });

    const toggleIcon = headerEl.createEl("span", {
      text: ">",
      cls: "evc-collapsible-icon",
    });

    headerEl.createEl("span", {
      text: `Skipped (${actions.length} files)`,
    });

    // Collapsible content
    const contentEl = groupEl.createDiv({
      cls: "evc-collapsible-content evc-collapsible-collapsed",
    });

    const listEl = contentEl.createEl("ul", { cls: "evc-dry-run-list" });

    for (const action of actions) {
      const itemEl = listEl.createEl("li", {
        cls: "evc-dry-run-item evc-dry-run-item-skip",
      });

      itemEl.createEl("span", {
        text: "-",
        cls: "evc-dry-run-icon evc-dry-run-icon-skip",
      });

      itemEl.createEl("span", {
        text: action.file,
        cls: "evc-dry-run-filename",
      });

      itemEl.createEl("span", {
        text: `(${action.reason})`,
        cls: "evc-dry-run-reason",
      });
    }

    // Toggle click handler
    headerEl.addEventListener("click", () => {
      const isCollapsed = contentEl.hasClass("evc-collapsible-collapsed");
      if (isCollapsed) {
        contentEl.removeClass("evc-collapsible-collapsed");
        toggleIcon.textContent = "v";
      } else {
        contentEl.addClass("evc-collapsible-collapsed");
        toggleIcon.textContent = ">";
      }
    });
  }

  /**
   * Render action buttons
   */
  private renderButtons(containerEl: HTMLElement, totalActions: number): void {
    const buttonsEl = containerEl.createDiv({ cls: "evc-modal-buttons" });

    // Close button
    const closeBtn = buttonsEl.createEl("button", {
      text: "Close",
      cls: "evc-btn",
    });
    closeBtn.addEventListener("click", () => {
      this.close();
    });

    // Execute sync button (only if there are actions)
    if (totalActions > 0) {
      const executeBtn = buttonsEl.createEl("button", {
        text: "Execute sync",
        cls: "evc-btn evc-btn-cta mod-cta",
      });
      executeBtn.addEventListener("click", async () => {
        executeBtn.disabled = true;
        executeBtn.textContent = "Syncing...";

        try {
          await this.onConfirm();
          this.close();
        } catch (error) {
          new Notice(`Sync failed: ${(error as Error).message}`);
          executeBtn.disabled = false;
          executeBtn.textContent = "Execute sync";
        }
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /**
   * Get total planned actions count
   */
  private getTotalActions(): number {
    let count = 0;
    for (const result of this.results) {
      for (const action of result.plannedActions) {
        if (action.action !== "skip") {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Get total errors count
   */
  private getTotalErrors(): number {
    return this.results.reduce((sum, r) => sum + r.errors.length, 0);
  }
}
