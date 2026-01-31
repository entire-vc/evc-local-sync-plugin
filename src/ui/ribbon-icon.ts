import { Menu } from "obsidian";
import type EVCLocalSyncPlugin from "../main";
import { EVC_ICON_ID } from "../main";
import { openPluginSettings } from "../obsidian-internal";

/**
 * Ribbon icon for quick sync access (FR-023)
 *
 * Features:
 * - Left-click: Sync All Projects
 * - Right-click: Show menu with sync options
 */
export class RibbonIcon {
  private plugin: EVCLocalSyncPlugin;
  private iconEl: HTMLElement | null = null;

  constructor(plugin: EVCLocalSyncPlugin) {
    this.plugin = plugin;
  }

  /**
   * Initialize the ribbon icon
   */
  init(): void {
    this.iconEl = this.plugin.addRibbonIcon(
      EVC_ICON_ID,
      "EVC Sync: Sync All Projects",
      (event: MouseEvent) => {
        if (event.button === 2) {
          // Right-click shows menu
          this.showMenu(event);
        } else {
          // Left-click syncs all
          void this.plugin.syncAllProjects();
        }
      }
    );

    this.iconEl.addClass("evc-ribbon-icon");

    // Prevent drag behavior on right-click
    this.iconEl.addEventListener("mousedown", (event: MouseEvent) => {
      if (event.button === 2) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    // Prevent drag start entirely for this icon
    this.iconEl.addEventListener("dragstart", (event: DragEvent) => {
      event.preventDefault();
    });

    // Add context menu on right-click
    this.iconEl.addEventListener("contextmenu", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.showMenu(event);
    });
  }

  /**
   * Show context menu with sync options
   */
  showMenu(event: MouseEvent): void {
    const menu = new Menu();

    // Sync All Projects
    menu.addItem((item) =>
      item
        .setTitle("Sync All Projects")
        .setIcon("refresh-cw")
        .onClick(() => {
          void this.plugin.syncAllProjects();
        })
    );

    // Sync Current Project
    menu.addItem((item) =>
      item
        .setTitle("Sync Current Project")
        .setIcon("file-sync")
        .onClick(() => {
          void this.plugin.syncCurrentProject();
        })
    );

    // Dry Run
    menu.addItem((item) =>
      item
        .setTitle("Dry Run (Preview)")
        .setIcon("eye")
        .onClick(() => {
          void this.plugin.dryRun();
        })
    );

    menu.addSeparator();

    // View Logs
    menu.addItem((item) =>
      item
        .setTitle("View Logs")
        .setIcon("file-text")
        .onClick(() => {
          this.plugin.viewLogs();
        })
    );

    // Settings
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
   * Remove the ribbon icon
   */
  destroy(): void {
    this.iconEl?.remove();
    this.iconEl = null;
  }
}
