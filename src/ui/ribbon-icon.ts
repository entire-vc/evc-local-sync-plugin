import { Menu } from "obsidian";
import type EVCLocalSyncPlugin from "../main";
import { EVC_ICON_ID } from "../main";

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
          this.plugin.syncAllProjects();
        }
      }
    );

    this.iconEl.addClass("evc-ribbon-icon");

    // Add context menu on right-click
    this.iconEl.addEventListener("contextmenu", (event: MouseEvent) => {
      event.preventDefault();
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
          this.plugin.syncAllProjects();
        })
    );

    // Sync Current Project
    menu.addItem((item) =>
      item
        .setTitle("Sync Current Project")
        .setIcon("file-sync")
        .onClick(() => {
          this.plugin.syncCurrentProject();
        })
    );

    // Dry Run
    menu.addItem((item) =>
      item
        .setTitle("Dry Run (Preview)")
        .setIcon("eye")
        .onClick(() => {
          this.plugin.dryRun();
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const setting = (this.plugin.app as any).setting as { open: () => void; openTabById: (id: string) => void } | undefined;
          if (setting) {
            setting.open();
            setting.openTabById(this.plugin.manifest.id);
          }
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
