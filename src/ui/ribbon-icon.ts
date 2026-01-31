import type EVCLocalSyncPlugin from "../main";
import { EVC_ICON_ID } from "../main";

/**
 * Ribbon icon for quick sync access (FR-023)
 *
 * Left-click: Sync All Projects
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
      () => {
        void this.plugin.syncAllProjects();
      }
    );

    this.iconEl.addClass("evc-ribbon-icon");
  }

  /**
   * Remove the ribbon icon
   */
  destroy(): void {
    this.iconEl?.remove();
    this.iconEl = null;
  }
}
