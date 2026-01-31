import type { App } from "obsidian";
import type { ConflictResolution } from "./settings";

/**
 * Information about a file conflict
 */
export interface ConflictInfo {
  relativePath: string;
  aiPath: string;
  obsidianPath: string;
  aiMtime: Date;
  obsidianMtime: Date;
  aiSize: number;
  obsidianSize: number;
}

/**
 * Resolution decision
 */
export type ResolutionDecision = "use-ai" | "use-obsidian" | "skip" | "merge";

/**
 * Result of conflict resolution
 */
export interface ResolutionResult {
  conflict: ConflictInfo;
  decision: ResolutionDecision;
  userChosen: boolean;
}

/**
 * Conflict resolver that handles version conflicts during sync (FR-013)
 *
 * Strategies:
 * - newer-wins: Compare mtime, newer file wins
 * - always-ask: Return 'skip' (UI will handle via modal)
 * - ai-wins: Always prefer AI version
 * - obsidian-wins: Always prefer Obsidian version
 */
export class ConflictResolver {
  private app: App;
  private strategy: ConflictResolution;

  constructor(app: App, strategy: ConflictResolution) {
    this.app = app;
    this.strategy = strategy;
  }

  /**
   * Update conflict resolution strategy
   */
  setStrategy(strategy: ConflictResolution): void {
    this.strategy = strategy;
  }

  /**
   * Get current strategy
   */
  getStrategy(): ConflictResolution {
    return this.strategy;
  }

  /**
   * Resolve a conflict based on the current strategy
   */
  resolve(conflict: ConflictInfo): ResolutionResult {
    switch (this.strategy) {
      case "newer-wins":
        return this.resolveNewerWins(conflict);

      case "ai-wins":
        return this.resolveAiWins(conflict);

      case "obsidian-wins":
        return this.resolveObsidianWins(conflict);

      case "always-ask":
        return this.resolveAlwaysAsk(conflict);

      default:
        // Default to newer-wins if unknown strategy
        return this.resolveNewerWins(conflict);
    }
  }

  /**
   * Resolve multiple conflicts
   */
  resolveAll(conflicts: ConflictInfo[]): ResolutionResult[] {
    const results: ResolutionResult[] = [];

    for (const conflict of conflicts) {
      const result = this.resolve(conflict);
      results.push(result);
    }

    return results;
  }

  /**
   * Resolve using "newer-wins" strategy
   * Compare mtime, newer file wins
   */
  private resolveNewerWins(conflict: ConflictInfo): ResolutionResult {
    const newerSource = this.getNewerSource(conflict);

    return {
      conflict,
      decision: newerSource === "ai" ? "use-ai" : "use-obsidian",
      userChosen: false,
    };
  }

  /**
   * Resolve using "ai-wins" strategy
   * Always prefer AI version
   */
  private resolveAiWins(conflict: ConflictInfo): ResolutionResult {
    return {
      conflict,
      decision: "use-ai",
      userChosen: false,
    };
  }

  /**
   * Resolve using "obsidian-wins" strategy
   * Always prefer Obsidian version
   */
  private resolveObsidianWins(conflict: ConflictInfo): ResolutionResult {
    return {
      conflict,
      decision: "use-obsidian",
      userChosen: false,
    };
  }

  /**
   * Resolve using "always-ask" strategy
   * Returns 'skip' - UI layer (ConflictModal) will handle this
   * The modal will call resolveWithUserChoice() when user makes a decision
   */
  private resolveAlwaysAsk(conflict: ConflictInfo): ResolutionResult {
    // In the "always-ask" strategy, we return skip
    // The UI layer (ConflictModal) should handle showing the modal
    // and then update the sync result based on user's choice
    return {
      conflict,
      decision: "skip",
      userChosen: false,
    };
  }

  /**
   * Resolve conflict with explicit user choice
   * Called from ConflictModal when user makes a decision
   */
  resolveWithUserChoice(
    conflict: ConflictInfo,
    decision: ResolutionDecision
  ): ResolutionResult {
    return {
      conflict,
      decision,
      userChosen: true,
    };
  }

  /**
   * Determine which version is newer
   */
  getNewerSource(conflict: ConflictInfo): "ai" | "obsidian" {
    const aiTime = conflict.aiMtime instanceof Date
      ? conflict.aiMtime.getTime()
      : conflict.aiMtime;
    const obsTime = conflict.obsidianMtime instanceof Date
      ? conflict.obsidianMtime.getTime()
      : conflict.obsidianMtime;

    return aiTime > obsTime ? "ai" : "obsidian";
  }

  /**
   * Get time difference between AI and Obsidian versions in milliseconds
   */
  getTimeDifference(conflict: ConflictInfo): number {
    const aiTime = conflict.aiMtime instanceof Date
      ? conflict.aiMtime.getTime()
      : conflict.aiMtime;
    const obsTime = conflict.obsidianMtime instanceof Date
      ? conflict.obsidianMtime.getTime()
      : conflict.obsidianMtime;

    return Math.abs(aiTime - obsTime);
  }

  /**
   * Format time difference for display
   */
  formatTimeDifference(conflict: ConflictInfo): string {
    const diffMs = this.getTimeDifference(conflict);
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? "s" : ""}`;
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? "s" : ""}`;
    } else if (diffMinutes > 0) {
      return `${diffMinutes} minute${diffMinutes > 1 ? "s" : ""}`;
    } else {
      return `${diffSeconds} second${diffSeconds > 1 ? "s" : ""}`;
    }
  }

  /**
   * Check if conflict is significant (files have different content likely)
   * Based on size difference and time difference
   */
  isSignificantConflict(conflict: ConflictInfo): boolean {
    // Size difference suggests content is different
    const sizeDiff = Math.abs(conflict.aiSize - conflict.obsidianSize);
    if (sizeDiff > 0) {
      return true;
    }

    // Time difference greater than 1 minute suggests intentional edit
    const timeDiff = this.getTimeDifference(conflict);
    if (timeDiff > 60000) {
      return true;
    }

    return false;
  }
}
