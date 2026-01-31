/**
 * Helper functions for accessing Obsidian internal APIs
 *
 * These are not part of the public Obsidian API but are commonly used.
 * Use with caution as they may change without notice.
 */

import type { App, FileSystemAdapter } from "obsidian";

/**
 * Extended FileSystemAdapter interface with basePath property
 */
interface FileSystemAdapterWithPath extends FileSystemAdapter {
  basePath: string;
}

/**
 * Internal setting manager interface
 */
interface ObsidianSettingManager {
  open: () => void;
  openTabById: (id: string) => void;
}

/**
 * Extended App interface with internal setting property
 */
interface AppWithSetting extends App {
  setting?: ObsidianSettingManager;
}

/**
 * Get vault base path safely
 */
export function getVaultBasePath(app: App): string {
  const adapter = app.vault.adapter as FileSystemAdapterWithPath;
  return adapter.basePath || "";
}

/**
 * Open plugin settings safely
 */
export function openPluginSettings(app: App, pluginId: string): void {
  const appWithSetting = app as AppWithSetting;
  if (appWithSetting.setting) {
    appWithSetting.setting.open();
    appWithSetting.setting.openTabById(pluginId);
  }
}
