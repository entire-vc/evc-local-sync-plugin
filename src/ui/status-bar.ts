import { Menu, setIcon } from "obsidian";
import type EVCLocalSyncPlugin from "../main";
import { EVC_ICON_ID } from "../main";
import { openPluginSettings } from "../obsidian-internal";

/**
 * Sync status states
 */
export type SyncStatus = "idle" | "syncing" | "success" | "error" | "watching";

/**
 * Status bar item for displaying sync status (FR-022)
 *
 * Features:
 * - Shows current sync status with icon only (no text)
 * - Click to open quick actions menu
 * - Updates during sync operations
 */
export class StatusBarItem {
  private plugin: EVCLocalSyncPlugin;
  private statusBarEl: HTMLElement | null = null;
  private currentStatus: SyncStatus = "idle";
  private statusTimeout: NodeJS.Timeout | null = null;

  constructor(plugin: EVCLocalSyncPlugin) {
    this.plugin = plugin;
  }

  /**
   * Initialize the status bar item
   */
  init(): void {
    this.statusBarEl = this.plugin.addStatusBarItem();
    this.statusBarEl.addClass("evc-status-bar");
    this.statusBarEl.setAttribute("aria-label", "EVC Sync Status");

    // Add click handler for quick actions menu
    this.statusBarEl.addEventListener("click", (e) => {
      this.showQuickActionsMenu(e);
    });

    // Set initial status based on file watcher state
    if (this.plugin.settings.syncMode === "on-change" && this.plugin.fileWatcher?.isActive()) {
      this.setStatus("watching");
    } else {
      this.setStatus("idle");
    }
  }

  /**
   * Update the displayed status
   */
  setStatus(status: SyncStatus, _message?: string): void {
    if (!this.statusBarEl) return;

    this.currentStatus = status;
    this.statusBarEl.empty();

    // Clear any pending timeout
    if (this.statusTimeout) {
      clearTimeout(this.statusTimeout);
      this.statusTimeout = null;
    }

    // Create icon container
    const iconEl = this.statusBarEl.createSpan({ cls: "evc-status-icon" });

    // Set icon based on status (use custom EVC icon for idle, standard icons for states)
    switch (status) {
      case "idle":
        setIcon(iconEl, EVC_ICON_ID);
        break;

      case "watching":
        setIcon(iconEl, EVC_ICON_ID);
        iconEl.addClass("evc-status-watching");
        break;

      case "syncing":
        setIcon(iconEl, "loader");
        iconEl.addClass("evc-status-syncing");
        break;

      case "success":
        setIcon(iconEl, "check-circle");
        iconEl.addClass("evc-status-success");
        // Return to idle/watching after 3 seconds
        this.statusTimeout = setTimeout(() => {
          if (this.plugin.settings.syncMode === "on-change" && this.plugin.fileWatcher?.isActive()) {
            this.setStatus("watching");
          } else {
            this.setStatus("idle");
          }
        }, 3000);
        break;

      case "error":
        setIcon(iconEl, "alert-circle");
        iconEl.addClass("evc-status-error");
        // Return to idle/watching after 5 seconds
        this.statusTimeout = setTimeout(() => {
          if (this.plugin.settings.syncMode === "on-change" && this.plugin.fileWatcher?.isActive()) {
            this.setStatus("watching");
          } else {
            this.setStatus("idle");
          }
        }, 5000);
        break;
    }

    // Update CSS class for styling
    this.statusBarEl.removeClass("evc-status-idle", "evc-status-watching", "evc-status-syncing", "evc-status-success", "evc-status-error");
    this.statusBarEl.addClass(`evc-status-${status}`);
  }

  /**
   * Show quick actions menu
   */
  private showQuickActionsMenu(event: MouseEvent): void {
    const menu = new Menu();

    // Sync All
    menu.addItem((item) =>
      item
        .setTitle("Sync all projects")
        .setIcon(EVC_ICON_ID)
        .onClick(() => {
          void this.plugin.syncAllProjects();
        })
    );

    // Sync Current
    menu.addItem((item) =>
      item
        .setTitle("Sync current project")
        .setIcon("file-sync")
        .onClick(() => {
          void this.plugin.syncCurrentProject();
        })
    );

    // Dry Run
    menu.addItem((item) =>
      item
        .setTitle("Dry run (preview)")
        .setIcon("eye")
        .onClick(() => {
          void this.plugin.dryRun();
        })
    );

    menu.addSeparator();

    // View Logs
    menu.addItem((item) =>
      item
        .setTitle("View logs")
        .setIcon("file-text")
        .onClick(() => {
          this.plugin.viewLogs();
        })
    );

    // Open Settings
    menu.addItem((item) =>
      item
        .setTitle("Settings")
        .setIcon("settings")
        .onClick(() => {
          openPluginSettings(this.plugin.app, this.plugin.manifest.id);
        })
    );

    menu.showAtMouseEvent(event);
  }

  /**
   * Get current status
   */
  getStatus(): SyncStatus {
    return this.currentStatus;
  }

  /**
   * Destroy the status bar item
   */
  destroy(): void {
    if (this.statusTimeout) {
      clearTimeout(this.statusTimeout);
      this.statusTimeout = null;
    }
    this.statusBarEl?.remove();
    this.statusBarEl = null;
  }
}
