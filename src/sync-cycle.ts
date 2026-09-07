import { SyncEngine, type SyncResult } from "./sync-engine";
import { SyncLogger, type SyncTriggerMode } from "./logger";
import type { ProjectMapping } from "./settings";

/**
 * The glue between a sync trigger and the log (#94002fd9): record the cycle
 * starting BEFORE running it, so a cycle that copies nothing is still
 * distinguishable from "never ran" — the exact shape of the storage
 * measurement that first exposed this — then run the engine and log every
 * per-file result it returns.
 *
 * Exported so both `main.ts` (the shipped startup/manual/scheduled trigger
 * paths) and its test import this SAME function. A prior version of this
 * fix had the test hand-copy this glue instead of calling the real thing;
 * that copy could never fail when the shipped code regressed, because it
 * never touched the shipped code.
 */
export async function runSyncCycle(
  logger: SyncLogger,
  engine: SyncEngine,
  mode: SyncTriggerMode,
  mappings: ProjectMapping[]
): Promise<SyncResult[]> {
  logger.logCycleStart(mode, mappings);

  const results = await engine.syncAll();

  for (const result of results) {
    for (const fileResult of result.files) {
      logger.log({
        mode,
        direction: fileResult.direction,
        mappingId: result.mapping.id,
        mappingName: result.mapping.name,
        file: fileResult.file,
        targetPath: fileResult.targetPath,
        action: fileResult.action,
        success: fileResult.success,
        error: fileResult.error,
      });
    }
  }

  return results;
}
