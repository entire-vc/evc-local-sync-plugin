import { App, Modal, DropdownComponent, TextComponent, Notice } from "obsidian";
import type { SyncLogger, LogEntry } from "../../logger";

/**
 * Filter options for log entries
 */
type LogFilter = "all" | "errors" | "today" | "week";

/**
 * Modal for viewing sync logs (FR-031)
 *
 * Features:
 * - Filter by: All / Errors only / Today / Last 7 days
 * - Search by file name
 * - Table display with timestamp, direction, file, action, details
 * - Clear Logs button (with confirmation)
 * - Export CSV button
 */
export class LogViewerModal extends Modal {
  private logger: SyncLogger;
  private filter: LogFilter = "all";
  private searchQuery = "";
  private tableContainer: HTMLElement | null = null;

  constructor(app: App, logger: SyncLogger) {
    super(app);
    this.logger = logger;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("evc-sync-modal", "evc-log-viewer-modal");

    // Title
    contentEl.createEl("h2", { text: "Sync Logs" });

    // Filter controls
    this.renderFilterControls(contentEl);

    // Table container
    this.tableContainer = contentEl.createDiv({ cls: "evc-log-table-container" });
    this.renderLogTable();

    // Footer buttons
    this.renderFooterButtons(contentEl);
  }

  /**
   * Render filter controls
   */
  private renderFilterControls(containerEl: HTMLElement): void {
    const controlsEl = containerEl.createDiv({ cls: "evc-log-controls" });

    // Filter dropdown
    const filterContainer = controlsEl.createDiv({ cls: "evc-log-filter-container" });
    filterContainer.createEl("label", {
      text: "Filter:",
      cls: "evc-log-filter-label",
    });

    const dropdown = new DropdownComponent(filterContainer);
    dropdown
      .addOption("all", "All logs")
      .addOption("errors", "Errors only")
      .addOption("today", "Today")
      .addOption("week", "Last 7 days")
      .setValue(this.filter)
      .onChange((value) => {
        this.filter = value as LogFilter;
        this.renderLogTable();
      });

    // Search input
    const searchContainer = controlsEl.createDiv({ cls: "evc-log-search-container" });
    searchContainer.createEl("label", {
      text: "Search:",
      cls: "evc-log-search-label",
    });

    const searchInput = new TextComponent(searchContainer);
    searchInput
      .setPlaceholder("Search by file name...")
      .setValue(this.searchQuery)
      .onChange((value) => {
        this.searchQuery = value;
        this.renderLogTable();
      });
    searchInput.inputEl.addClass("evc-log-search-input");
  }

  /**
   * Render log table
   */
  private renderLogTable(): void {
    if (!this.tableContainer) return;

    this.tableContainer.empty();

    const entries = this.getFilteredEntries();

    if (entries.length === 0) {
      const emptyEl = this.tableContainer.createDiv({ cls: "evc-log-empty" });
      emptyEl.createEl("div", {
        text: this.logger.getCount() === 0 ? "No logs yet" : "No matching logs",
        cls: "evc-log-empty-title",
      });
      if (this.logger.getCount() > 0) {
        emptyEl.createEl("div", {
          text: "Try adjusting your filter or search",
          cls: "evc-log-empty-subtitle",
        });
      }
      return;
    }

    // Stats summary
    const statsEl = this.tableContainer.createDiv({ cls: "evc-log-stats" });
    const successCount = entries.filter((e) => e.success).length;
    const errorCount = entries.filter((e) => !e.success).length;
    statsEl.textContent = `Showing ${entries.length} entries (${successCount} success, ${errorCount} errors)`;

    // Table
    const tableEl = this.tableContainer.createEl("table", { cls: "evc-log-table" });

    // Header
    const thead = tableEl.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: "Time" });
    headerRow.createEl("th", { text: "Direction" });
    headerRow.createEl("th", { text: "File" });
    headerRow.createEl("th", { text: "Action" });
    headerRow.createEl("th", { text: "Status" });

    // Body
    const tbody = tableEl.createEl("tbody");

    // Show most recent first
    const sortedEntries = [...entries].reverse();

    for (const entry of sortedEntries) {
      const row = tbody.createEl("tr", {
        cls: entry.success ? "" : "evc-log-row-error",
      });

      // Timestamp
      row.createEl("td", {
        text: this.formatTimestamp(entry.timestamp),
        cls: "evc-log-cell-timestamp",
      });

      // Direction
      const dirCell = row.createEl("td", { cls: "evc-log-cell-direction" });
      const dirText = entry.direction === "ai-to-obs" ? "AI -> Obs" : "Obs -> AI";
      const dirClass =
        entry.direction === "ai-to-obs"
          ? "evc-log-direction-ai-to-obs"
          : "evc-log-direction-obs-to-ai";
      dirCell.createEl("span", {
        text: dirText,
        cls: dirClass,
      });

      // File
      const fileCell = row.createEl("td", { cls: "evc-log-cell-file" });
      fileCell.createEl("span", {
        text: entry.file,
        attr: { title: entry.file },
      });

      // Action
      const actionCell = row.createEl("td", { cls: "evc-log-cell-action" });
      actionCell.createEl("span", {
        text: entry.action,
        cls: `evc-log-action evc-log-action-${entry.action}`,
      });

      // Status
      const statusCell = row.createEl("td", { cls: "evc-log-cell-status" });
      if (entry.success) {
        statusCell.createEl("span", {
          text: "OK",
          cls: "evc-log-status-success",
        });
      } else {
        const errorSpan = statusCell.createEl("span", {
          text: "Error",
          cls: "evc-log-status-error",
          attr: { title: entry.error || "Unknown error" },
        });
        if (entry.error) {
          errorSpan.addEventListener("click", () => {
            new Notice(entry.error || "Unknown error", 5000);
          });
        }
      }
    }
  }

  /**
   * Get filtered and searched log entries
   */
  private getFilteredEntries(): LogEntry[] {
    let entries = this.logger.getAll();

    // Apply filter
    switch (this.filter) {
      case "errors":
        entries = entries.filter((e) => !e.success);
        break;
      case "today": {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        entries = entries.filter((e) => {
          const entryTime = e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp);
          return entryTime >= todayStart;
        });
        break;
      }
      case "week": {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        weekAgo.setHours(0, 0, 0, 0);
        entries = entries.filter((e) => {
          const entryTime = e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp);
          return entryTime >= weekAgo;
        });
        break;
      }
    }

    // Apply search
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      entries = entries.filter((e) => e.file.toLowerCase().includes(query));
    }

    return entries;
  }

  /**
   * Format timestamp for display
   */
  private formatTimestamp(timestamp: Date | string): string {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    if (isToday) {
      return timeStr;
    }

    const dateStr = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    return `${dateStr}, ${timeStr}`;
  }

  /**
   * Render footer buttons
   */
  private renderFooterButtons(containerEl: HTMLElement): void {
    const buttonsEl = containerEl.createDiv({ cls: "evc-modal-buttons" });

    // Clear Logs button
    const clearBtn = buttonsEl.createEl("button", {
      text: "Clear Logs",
      cls: "evc-btn evc-btn-delete",
    });
    clearBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to clear all sync logs? This cannot be undone.")) {
        this.logger.clear();
        this.renderLogTable();
        new Notice("Sync logs cleared");
      }
    });

    // Export CSV button
    const exportBtn = buttonsEl.createEl("button", {
      text: "Export CSV",
      cls: "evc-btn",
    });
    exportBtn.addEventListener("click", () => {
      this.exportCsv();
    });

    // Close button
    const closeBtn = buttonsEl.createEl("button", {
      text: "Close",
      cls: "evc-btn evc-btn-cta mod-cta",
    });
    closeBtn.addEventListener("click", () => {
      this.close();
    });
  }

  /**
   * Export logs to CSV and trigger download
   */
  private exportCsv(): void {
    const entries = this.getFilteredEntries();

    if (entries.length === 0) {
      new Notice("No logs to export");
      return;
    }

    const csvContent = this.logger.exportAsCsv();

    // Create blob and download link
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `evc-sync-logs-${new Date().toISOString().slice(0, 10)}.csv`
    );
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);

    new Notice(`Exported ${entries.length} log entries to CSV`);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
