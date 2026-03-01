import { Plugin, Notice, addIcon } from "obsidian";
import { openPluginSettings } from "./obsidian-internal";

// Custom EVC icon SVG (simplified for Obsidian)
const EVC_ICON_SVG = `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
    <path fill="currentColor" stroke="none" d="M 147.698303 23.192139 C 172.006485 22.652313 195.962112 29.072418 216.742218 41.696381 C 248.759583 61.091949 267.721954 89.853516 276.548492 125.791656 C 278.05777 123.383087 279.560181 120.976318 281.158081 118.625214 C 284.359619 113.914719 291.432404 113.189377 295.861603 116.561234 C 298.136017 118.290024 299.605896 120.872879 299.930969 123.711411 C 300.487488 128.34996 297.56543 131.972748 295.260254 135.761902 L 288.910339 146.187027 L 282.347015 156.841782 C 279.223175 161.914566 277.231903 166.932083 270.429932 167.068008 C 264.941681 167.177567 261.63562 162.896667 257.965393 159.459366 L 247.247757 149.399796 L 239.678513 142.276398 C 236.372086 139.158005 233.266357 136.98735 232.988663 132.371597 C 232.321503 121.275345 245.617325 117.459076 252.269211 125.503479 C 252.938889 126.313446 255.029266 128.00679 255.87178 128.751678 C 252.481476 113.604126 245.596375 100.213928 236.619049 87.683594 C 232.156998 81.909302 227.516998 76.589874 222.056564 71.735474 C 200.7659 52.772385 172.870346 42.945343 144.395142 44.377258 C 112.12104 46.106033 82.298904 62.135864 63.051239 88.100143 C 60.253216 91.832886 58.000126 95.677368 55.63855 99.683456 C 53.393776 103.491425 51.669689 109.032486 47.554749 111.132996 C 40.668186 114.648041 32.314632 110.062302 32.179035 102.149902 C 32.113224 98.320984 34.179012 95.069534 35.925156 91.77504 C 41.416328 81.333984 48.321693 71.700394 56.445629 63.146881 C 80.256981 38.105408 113.147247 23.704895 147.698303 23.192139 Z"/>
    <path fill="currentColor" stroke="none" d="M 29.986689 136.161835 C 36.142467 135.527954 39.625706 140.201202 43.678093 144.051819 L 53.783207 153.622482 C 56.00412 155.725159 58.236256 157.816269 60.479939 159.895081 C 61.852913 161.169342 65.004204 163.852356 65.80912 165.265823 C 69.714699 172.125275 65.584206 180.973862 57.439289 181.270721 C 51.755032 181.477539 48.610603 177.51918 44.997921 174.225433 C 45.180885 174.914612 45.36927 175.602753 45.56345 176.289017 C 53.392685 204.099609 71.903786 227.685333 97.057381 241.898895 C 121.929283 255.759521 151.243729 259.31723 178.709335 251.808746 C 203.96492 244.888916 225.838486 229.01239 240.244049 207.144257 C 241.944626 204.583435 243.520813 201.941986 244.966095 199.228943 C 246.057022 197.146149 247.056122 195.028656 248.164398 192.950577 C 250.909988 187.80365 257.694946 185.818848 262.75943 188.893143 C 265.148865 190.363007 266.857025 192.720978 267.508606 195.449554 C 267.908539 197.034424 267.950134 198.68837 267.630829 200.291321 C 266.990814 203.514557 262.248871 211.636322 260.458618 214.649841 C 258.322662 218.350067 255.155106 222.786453 252.581985 226.165924 C 235.261261 248.842209 210.930313 265.156647 183.375732 272.570404 C 150.259842 281.309052 115.033676 276.636536 85.340996 259.566742 C 60.278526 245.082001 40.839943 222.560104 30.174717 195.64917 C 27.627645 189.291611 25.936831 183.577698 24.180571 176.999924 C 22.475651 179.686218 20.626822 182.298004 18.926962 184.971283 C 15.74855 189.969238 8.593682 191.124908 3.878131 187.558472 C 1.79679 185.966751 0.4415 183.605896 0.116897 181.005661 C -0.287729 178.000122 0.370373 176.305664 1.90021 173.741608 C 2.974506 171.941223 4.090024 170.149887 5.185654 168.36145 L 12.823971 155.890045 C 14.743677 152.766586 16.644217 149.631577 18.525955 146.484985 C 21.79043 141.014435 23.01515 137.085709 29.986689 136.161835 Z"/>
    <path fill="currentColor" stroke="none" d="M 73.592972 94.859146 C 88.508751 94.623535 103.499176 94.923508 118.426666 94.777191 C 122.426338 94.737686 126.264519 95.91954 128.206299 99.84407 C 131.403107 106.304489 135.200836 112.761017 137.710861 119.500931 C 139.812149 125.725739 132.81665 133.806519 126.052345 131.52623 C 119.953362 129.470306 117.396011 120.459854 114.492378 115.098862 C 109.636688 115.052536 104.780533 115.035461 99.924843 115.048615 C 97.830879 115.04715 93.330788 114.92276 91.434837 115.252487 L 91.154869 115.694427 C 91.200729 117.74498 127.753189 187.457504 131.267517 194.205719 L 168.813065 194.172516 C 171.14212 189.338318 173.758453 184.402161 176.213882 179.614777 C 178.46196 175.242447 180.688141 168.305008 185.830612 166.848541 C 188.14357 166.214447 190.614594 166.54567 192.679306 167.766006 C 196.409714 170.012177 198.625626 175.769714 197.115982 179.864502 C 195.108353 185.310394 191.912552 190.62796 189.364471 195.8685 C 187.009033 200.712463 184.506821 205.600311 181.918274 210.321869 C 180.73204 212.113907 178.417587 213.701111 176.222656 213.903992 C 171.118698 214.37616 165.649918 214.064957 160.512817 214.106903 L 138.269348 214.163498 C 134.05899 214.178619 129.680817 214.262024 125.477753 214.114716 C 124.185692 214.069855 121.530785 213.564056 120.565987 212.81192 C 119.162216 211.717377 117.651627 209.777527 116.811684 208.179123 C 114.253372 203.308334 111.737495 198.369232 109.22599 193.47406 L 93.368835 162.579163 L 75.387444 128.083099 C 72.13163 121.829987 66.884285 112.90831 64.804459 106.065475 C 64.180122 104.010559 65.484406 99.784576 66.943779 98.113968 C 68.857269 95.923431 70.674194 95.11618 73.592972 94.859146 Z"/>
    <path fill="currentColor" stroke="none" d="M 178.026413 94.821091 C 187.720688 94.38942 197.567169 94.765472 207.27803 94.750366 C 212.97316 94.741119 222.806961 94.174316 227.893341 95.080078 C 229.858047 95.429825 231.714478 97.305756 232.815338 98.904144 C 234.273758 101.023972 235.121979 104.270523 234.591278 106.846405 C 233.857712 110.407043 220.670029 136.315567 218.381973 139.822586 C 217.694229 140.876144 216.898666 141.725845 215.84169 142.419434 C 213.957474 143.655914 211.438156 144.212921 209.219833 143.73053 C 206.609314 143.163269 204.438293 141.366837 203.060364 139.118729 C 199.008041 132.506149 203.961243 125.639893 207.029785 119.813568 C 207.631683 118.671219 208.574509 117.189896 208.788132 115.915359 C 208.852539 115.52858 208.69841 115.456863 208.495499 115.154968 C 206.504959 114.568176 188.512329 114.991562 185.20726 114.998367 C 182.901611 119.033157 180.271103 124.53511 178.050308 128.81279 C 176.851898 131.425247 174.863266 134.960068 173.502899 137.573013 L 164.575363 154.832504 C 161.369781 161.22316 158.112518 167.587524 154.803024 173.925507 C 153.57338 176.242859 151.659424 180.090805 150.211731 182.168213 L 149.491791 182.211609 C 148.217743 180.781006 140.329178 165.033096 138.833191 162.1465 C 139.655579 160.123276 141.690033 156.552856 142.773834 154.502777 L 149.70105 141.201981 C 156.744827 127.614853 163.868118 114.077469 171.014801 100.544983 C 172.740051 97.277451 174.476974 95.821503 178.026413 94.821091 Z"/>
</svg>`;

export const EVC_ICON_ID = "evc-sync-icon";
import {
  EVCLocalSyncSettings,
  DEFAULT_SETTINGS,
  EVCLocalSyncSettingTab,
} from "./settings";
import { MappingManager } from "./mapping-manager";
import { SyncEngine } from "./sync-engine";
import { SyncLogger, DEFAULT_LOGGER_CONFIG } from "./logger";
import { FileWatcher, FileChangeEvent } from "./file-watcher";
import { DryRunModal } from "./ui/modals/dry-run-modal";
import { LogViewerModal } from "./ui/modals/log-viewer-modal";
import { ConflictModal } from "./ui/modals/conflict-modal";
import { StatusBarItem } from "./ui/status-bar";
import { RibbonIcon } from "./ui/ribbon-icon";
import type { ConflictInfo, ResolutionDecision } from "./conflict-resolver";

/**
 * EVC Local Sync to AI Agent
 *
 * Obsidian plugin for bidirectional synchronization of documentation
 * between Obsidian vault and AI development projects.
 */
export default class EVCLocalSyncPlugin extends Plugin {
  settings: EVCLocalSyncSettings = DEFAULT_SETTINGS;
  mappingManager: MappingManager;
  syncEngine: SyncEngine;
  logger: SyncLogger;
  fileWatcher: FileWatcher;
  statusBar: StatusBarItem;
  ribbonIcon: RibbonIcon;
  private scheduledSyncInterval: NodeJS.Timeout | null = null;

  async onload(): Promise<void> {
    // Register custom icon
    addIcon(EVC_ICON_ID, EVC_ICON_SVG);

    // Load settings
    await this.loadSettings();

    // Initialize managers
    this.mappingManager = new MappingManager(
      this.app,
      this.settings,
      () => this.saveSettings()
    );

    // Get plugin data directory path
    const pluginDir = (this.app.vault.adapter as {basePath?: string}).basePath
      ? `${(this.app.vault.adapter as {basePath: string}).basePath}/${this.app.vault.configDir}/plugins/${this.manifest.id}`
      : `${this.app.vault.configDir}/plugins/${this.manifest.id}`;

    this.syncEngine = new SyncEngine(this.app, this.settings, pluginDir);
    this.syncEngine.setConflictModalCallback((conflict) => this.showConflictModal(conflict));

    // Initialize sync state manager
    await this.syncEngine.init();

    this.logger = new SyncLogger(this.app, {
      ...DEFAULT_LOGGER_CONFIG,
      retentionDays: this.settings.logRetentionDays,
    });
    await this.logger.load();

    // Register settings tab
    this.addSettingTab(new EVCLocalSyncSettingTab(this.app, this));

    // Register commands
    this.registerCommands();

    // Initialize file watcher
    this.fileWatcher = new FileWatcher(this.app, this.settings);
    this.fileWatcher.onFileChange((events) => void this.handleFileChanges(events));

    // Start file watcher if syncMode is "on-change"
    if (this.settings.syncMode === "on-change") {
      // Delay to allow Obsidian to fully load
      setTimeout(() => {
        this.fileWatcher.start();
      }, 3000);
    }

    // Initialize status bar
    this.statusBar = new StatusBarItem(this);
    this.statusBar.init();

    // Initialize ribbon icon
    this.ribbonIcon = new RibbonIcon(this);
    this.ribbonIcon.init();

    // Start scheduled sync if enabled
    if (this.settings.syncMode === "scheduled") {
      this.startScheduledSync();
    }

    // Sync on startup if enabled
    if (this.settings.syncOnStartup && this.settings.syncMode !== "manual") {
      // Delay to allow Obsidian to fully load
      setTimeout(() => {
        void this.syncAllProjects();
      }, 2000);
    }
  }

  onunload(): void {
    // Stop scheduled sync
    this.stopScheduledSync();

    // Stop file watcher
    void this.fileWatcher?.stop();

    // Destroy UI elements
    this.statusBar?.destroy();
    this.ribbonIcon?.destroy();

    // Save logger state
    void this.logger?.save();
  }

  /**
   * Start scheduled sync interval
   */
  private startScheduledSync(): void {
    this.stopScheduledSync(); // Clear any existing interval

    const intervalMs = this.settings.scheduledIntervalMinutes * 60 * 1000;

    this.scheduledSyncInterval = setInterval(() => {
      console.debug("EVC Sync: Running scheduled sync...");
      void this.syncAllProjects();
    }, intervalMs);

    console.debug(`EVC Sync: Scheduled sync started (every ${this.settings.scheduledIntervalMinutes} minutes)`);
  }

  /**
   * Stop scheduled sync interval
   */
  private stopScheduledSync(): void {
    if (this.scheduledSyncInterval) {
      clearInterval(this.scheduledSyncInterval);
      this.scheduledSyncInterval = null;
      console.debug("EVC Sync: Scheduled sync stopped");
    }
  }

  /**
   * Load plugin settings from data.json
   */
  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<EVCLocalSyncSettings> | undefined;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }

  /**
   * Save plugin settings to data.json
   */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Update managers with new settings
    this.mappingManager?.updateSettings(this.settings);
    this.syncEngine?.updateSettings(this.settings);
    this.logger?.setConfig({ retentionDays: this.settings.logRetentionDays });

    // Update file watcher
    if (this.fileWatcher) {
      this.fileWatcher.updateSettings(this.settings);
      // Start/stop watcher based on sync mode
      if (this.settings.syncMode === "on-change" && !this.fileWatcher.isActive()) {
        this.fileWatcher.start();
        this.statusBar?.setStatus("watching");
      } else if (this.settings.syncMode !== "on-change" && this.fileWatcher.isActive()) {
        void this.fileWatcher.stop();
        this.statusBar?.setStatus("idle");
      }
    }

    // Start/stop scheduled sync based on sync mode
    if (this.settings.syncMode === "scheduled") {
      this.startScheduledSync();
    } else {
      this.stopScheduledSync();
    }
  }

  /**
   * Register plugin commands (FR-021)
   */
  private registerCommands(): void {
    // Sync All Projects
    this.addCommand({
      id: "sync-all-projects",
      name: "Sync all projects",
      callback: () => void this.syncAllProjects(),
    });

    // Sync Current Project
    this.addCommand({
      id: "sync-current-project",
      name: "Sync current project",
      callback: () => void this.syncCurrentProject(),
    });

    // Dry Run
    this.addCommand({
      id: "dry-run",
      name: "Dry run (preview changes)",
      callback: () => void this.dryRun(),
    });

    // Open Settings
    this.addCommand({
      id: "open-settings",
      name: "Open settings",
      callback: () => {
        openPluginSettings(this.app, this.manifest.id);
      },
    });

    // View Logs
    this.addCommand({
      id: "view-logs",
      name: "View sync logs",
      callback: () => this.viewLogs(),
    });
  }

  /**
   * Sync all enabled project mappings (FR-021)
   */
  async syncAllProjects(): Promise<void> {
    const enabledMappings = this.mappingManager.getEnabled();

    if (enabledMappings.length === 0) {
      new Notice("EVC Sync: no enabled mappings found");
      return;
    }

    // Update status bar
    this.statusBar?.setStatus("syncing", "Syncing...");
    new Notice(`EVC Sync: syncing ${enabledMappings.length} project(s)...`);

    try {
      const results = await this.syncEngine.syncAll();

      // Log all sync operations
      for (const result of results) {
        for (const fileResult of result.files) {
          this.logger.log({
            direction: fileResult.direction,
            mappingId: result.mapping.id,
            mappingName: result.mapping.name,
            file: fileResult.file,
            action: fileResult.action,
            success: fileResult.success,
            error: fileResult.error,
          });
        }
      }

      // Calculate totals
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.length - successCount;
      const totalFiles = results.reduce((sum, r) => sum + r.filesCopied, 0);
      const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

      // Show appropriate notification (FR-024)
      if (failCount === 0 && totalErrors === 0) {
        this.statusBar?.setStatus("success", `${totalFiles} synced`);
        new Notice(
          `EVC Sync: Synced ${totalFiles} file(s) across ${successCount} project(s)`,
          5000
        );
      } else if (totalErrors > 0) {
        this.statusBar?.setStatus("error", `${totalErrors} errors`);
        new Notice(
          `EVC Sync: Completed with ${totalErrors} error(s). View logs for details.`,
          5000
        );
      } else {
        this.statusBar?.setStatus("error", `${failCount} failed`);
        new Notice(
          `EVC Sync: ${successCount} succeeded, ${failCount} failed. Check logs for details.`,
          5000
        );
      }
    } catch (error) {
      console.error("EVC Sync: Sync failed", error);
      this.statusBar?.setStatus("error", "Sync failed");
      new Notice(`EVC Sync: Sync failed - ${(error as Error).message}`, 5000);
    }
  }

  /**
   * Sync the project associated with the currently active file (FR-021)
   */
  async syncCurrentProject(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      new Notice("EVC Sync: no active file");
      return;
    }

    const mapping = this.mappingManager.findByFilePath(activeFile.path);

    if (!mapping) {
      new Notice("EVC Sync: no mapping found for current file");
      return;
    }

    if (!mapping.syncEnabled) {
      new Notice(`EVC Sync: Mapping "${mapping.name}" is disabled`);
      return;
    }

    this.statusBar?.setStatus("syncing", `Syncing ${mapping.name}...`);
    new Notice(`EVC Sync: Syncing "${mapping.name}"...`);

    try {
      const result = await this.syncEngine.syncMapping(mapping);

      // Log all sync operations
      for (const fileResult of result.files) {
        this.logger.log({
          direction: fileResult.direction,
          mappingId: result.mapping.id,
          mappingName: result.mapping.name,
          file: fileResult.file,
          action: fileResult.action,
          success: fileResult.success,
          error: fileResult.error,
        });
      }

      // Show appropriate notification (FR-024)
      if (result.success) {
        const fileCount = result.filesCopied;
        this.statusBar?.setStatus("success", `${fileCount} synced`);
        new Notice(
          `EVC Sync: Synced ${fileCount} file(s) for "${mapping.name}"`,
          5000
        );
      } else {
        this.statusBar?.setStatus("error", "Sync errors");
        new Notice(
          `EVC Sync: "${mapping.name}" sync completed with errors. View logs for details.`,
          5000
        );
      }
    } catch (error) {
      console.error("EVC Sync: Sync failed", error);
      this.statusBar?.setStatus("error", "Sync failed");
      new Notice(`EVC Sync: Sync failed - ${(error as Error).message}`, 5000);
    }
  }

  /**
   * Perform a dry run and show planned changes (FR-014)
   */
  async dryRun(): Promise<void> {
    const enabledMappings = this.mappingManager.getEnabled();

    if (enabledMappings.length === 0) {
      new Notice("EVC Sync: no enabled mappings found");
      return;
    }

    new Notice("EVC Sync: analyzing changes...");

    try {
      const results = await this.syncEngine.dryRunAll();

      // Open DryRunModal with results
      const modal = new DryRunModal(this.app, {
        results,
        onConfirm: async () => {
          // Execute actual sync when user confirms
          await this.syncAllProjects();
        },
      });
      modal.open();
    } catch (error) {
      console.error("EVC Sync: Dry run failed", error);
      new Notice(`EVC Sync: Dry run failed - ${(error as Error).message}`, 5000);
    }
  }

  /**
   * View sync logs (FR-031)
   */
  viewLogs(): void {
    // Open LogViewerModal
    const modal = new LogViewerModal(this.app, this.logger);
    modal.open();
  }

  /**
   * Show conflict modal and wait for user decision (FR-013)
   */
  private showConflictModal(conflict: ConflictInfo): Promise<ResolutionDecision> {
    return new Promise((resolve) => {
      const modal = new ConflictModal(this.app, {
        conflict,
        onResolve: (decision) => {
          resolve(decision);
        },
      });
      modal.open();
    });
  }

  /**
   * Handle file changes from FileWatcher (FR-040)
   */
  private async handleFileChanges(events: FileChangeEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    // Group events by mapping
    const eventsByMapping = new Map<string, FileChangeEvent[]>();
    for (const event of events) {
      const mappingId = event.mapping.id;
      if (!eventsByMapping.has(mappingId)) {
        eventsByMapping.set(mappingId, []);
      }
      eventsByMapping.get(mappingId)!.push(event);
    }

    // Sync each affected mapping
    for (const [mappingId, mappingEvents] of eventsByMapping) {
      const mapping = this.settings.mappings.find((m) => m.id === mappingId);
      if (!mapping || !mapping.syncEnabled) {
        continue;
      }

      // Log what triggered the sync
      const fileNames = mappingEvents.map((e) => e.relativePath).join(", ");
      console.debug(`EVC Sync: Auto-sync triggered for "${mapping.name}" by: ${fileNames}`);

      try {
        const result = await this.syncEngine.syncMapping(mapping);

        // Log all sync operations
        for (const fileResult of result.files) {
          this.logger.log({
            direction: fileResult.direction,
            mappingId: result.mapping.id,
            mappingName: result.mapping.name,
            file: fileResult.file,
            action: fileResult.action,
            success: fileResult.success,
            error: fileResult.error,
          });
        }

        // Show notification only if enabled and files were actually synced
        if (result.filesCopied > 0 && this.settings.showAutoSyncNotifications) {
          new Notice(
            `EVC Sync: Auto-synced ${result.filesCopied} file(s) for "${mapping.name}"`,
            3000
          );
        }
      } catch (error) {
        console.error(`EVC Sync: Auto-sync failed for "${mapping.name}"`, error);
        new Notice(
          `EVC Sync: Auto-sync failed for "${mapping.name}" - ${(error as Error).message}`,
          5000
        );
      }
    }
  }
}
