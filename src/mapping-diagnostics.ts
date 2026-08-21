/**
 * Config-shape diagnostics for mappings (#4dce529d).
 *
 * These do NOT inspect file content and do NOT run during sync. They read the
 * RESOLVED roots of every mapping once, at load, and name shapes that have twice
 * produced a silent duplication incident. The point is to say it out loud at the
 * moment the config is wrong, instead of leaving it to be discovered three months
 * later by the size of a folder.
 *
 * Everything here is a pure function over plain data so it can be tested without
 * an Obsidian app instance — the caller resolves the roots and lists the child
 * folders, this module only judges the shapes.
 */

export type MappingDiagnosticKind =
  | "folded-docs-subdir"
  | "overlapping-obs-root"
  | "overlapping-ai-root";

export interface MappingDiagnostic {
  kind: MappingDiagnosticKind;
  mappingId: string;
  mappingName: string;
  message: string;
}

/**
 * A mapping's roots after docsSubdir has been applied — i.e. the paths the sync
 * engine actually scans, not the raw settings fields.
 */
export interface ResolvedMappingRoots {
  id: string;
  name: string;
  /** Resolved AI-side docs root (absolute, or vault-relative for intra-vault). */
  aiRoot: string;
  /** Resolved Obsidian-side docs root (vault-relative). */
  obsRoot: string;
  /** The mapping's docsSubdir, verbatim. */
  docsSubdir: string;
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function basename(p: string): string {
  const parts = normalizeSlashes(p).split("/").filter((s) => s.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

/**
 * Is `child` the same as, or nested inside, `parent`?
 *
 * Compared case-insensitively: the incidents this guards against happened on
 * macOS, where "Docs" and "docs" are the same directory, and a case-sensitive
 * comparison would miss the overlap it is meant to catch.
 */
export function isPathInsideOrEqual(child: string, parent: string): boolean {
  const c = normalizeSlashes(child).toLowerCase();
  const p = normalizeSlashes(parent).toLowerCase();
  if (c.length === 0 || p.length === 0) {
    return false;
  }
  return c === p || c.startsWith(p + "/");
}

/**
 * Detect the signature left behind by folding `docsSubdir` into `aiPath`.
 *
 * The fold looks harmless — `aiPath="repo" + docsSubdir="docs"` becomes
 * `aiPath="repo/docs" + docsSubdir=""`, and the AI root does not move. But
 * `docsSubdir` was applied to BOTH sides, so emptying it moves the OBSIDIAN root
 * one level UP, and the whole previous Obsidian root becomes an ordinary subfolder
 * of the new one. The next bidirectional sync honestly concludes those files exist
 * only in Obsidian and copies them across as `<aiRoot>/docs/*`. Then it repeats.
 *
 * This has happened twice — `dev-docs` (#9d86c756, 115 duplicate files on each
 * side) and `PPE TenderMate` (#4dce529d, 221 files of which 107 unique) — and both
 * times the residue is the same: a folder sitting directly inside the Obsidian root
 * whose name equals the basename of the AI root.
 *
 * Deliberately a WARNING, not an error, and deliberately narrow:
 *
 *  - It only fires when `docsSubdir` is EMPTY, because a non-empty docsSubdir means
 *    the fold has not happened. That is what separates the folded shape from the
 *    plugin's own default new-mapping shape (both sides gaining a matching "/docs"),
 *    which is symmetric and correct.
 *  - Even so it is a heuristic, and it CAN be a false positive: a vault folder may
 *    legitimately contain a subfolder that happens to share the AI root's basename.
 *    So it asks the user to look, and never blocks or changes anything itself.
 *
 * @param roots      Resolved roots for one mapping.
 * @param obsChildFolderNames Names of folders directly inside `roots.obsRoot`.
 */
export function detectFoldSignature(
  roots: ResolvedMappingRoots,
  obsChildFolderNames: string[]
): MappingDiagnostic | undefined {
  if (roots.docsSubdir.trim().length > 0) {
    return undefined;
  }

  const aiBase = basename(roots.aiRoot);
  if (aiBase.length === 0) {
    return undefined;
  }

  const match = obsChildFolderNames.find(
    (name) => name.toLowerCase() === aiBase.toLowerCase()
  );
  if (match === undefined) {
    return undefined;
  }

  return {
    kind: "folded-docs-subdir",
    mappingId: roots.id,
    mappingName: roots.name,
    message:
      `Mapping "${roots.name}": the vault folder "${roots.obsRoot}" contains a subfolder ` +
      `"${match}" with the same name as the last segment of the AI path ` +
      `("${roots.aiRoot}"), and this mapping has no docs subdirectory set. ` +
      `That is the shape left behind when a docs subdirectory is folded into the AI ` +
      `path: the vault-side root moves up one level and its previous contents become ` +
      `a nested copy. If "${match}" holds the same documents as "${roots.obsRoot}", ` +
      `this mapping will keep duplicating them. If it is a genuine subfolder, ignore this.`,
  };
}

/**
 * Detect mappings whose resolved roots contain one another.
 *
 * The sync engine already refuses to descend into another mapping's root while
 * scanning (#14), so an overlap is not fatal by itself — but it is the aggravating
 * factor in #4dce529d, where `TenderMate → PPE TenderMate` and
 * `TenderMate Parsers → PPE TenderMate/Parsers` produced mixed paths such as
 * `docs/docs/Parsers/docs/docs/docs`. A user cannot check this shape by eye across
 * a dozen mappings; a config-level check can, which is the acceptance criterion
 * this function answers ("mappings do not overlap — verified against the config,
 * not by eye").
 *
 * Each overlapping pair is reported ONCE, attributed to the nested (inner) mapping,
 * since that is the one whose placement is the fixable half.
 */
export function detectOverlappingRoots(
  all: ResolvedMappingRoots[]
): MappingDiagnostic[] {
  const diagnostics: MappingDiagnostic[] = [];

  for (const inner of all) {
    for (const outer of all) {
      if (inner.id === outer.id) {
        continue;
      }

      if (
        inner.obsRoot &&
        outer.obsRoot &&
        isPathInsideOrEqual(inner.obsRoot, outer.obsRoot) &&
        normalizeSlashes(inner.obsRoot).toLowerCase() !==
          normalizeSlashes(outer.obsRoot).toLowerCase()
      ) {
        diagnostics.push({
          kind: "overlapping-obs-root",
          mappingId: inner.id,
          mappingName: inner.name,
          message:
            `Mapping "${inner.name}" syncs "${inner.obsRoot}", which sits inside ` +
            `"${outer.obsRoot}" synced by mapping "${outer.name}". Each mapping skips ` +
            `the other's folder while scanning, so this is not fatal — but nested ` +
            `mapping roots are how duplicated trees start. Prefer moving one root out ` +
            `of the other.`,
        });
      }

      if (
        inner.aiRoot &&
        outer.aiRoot &&
        isPathInsideOrEqual(inner.aiRoot, outer.aiRoot) &&
        normalizeSlashes(inner.aiRoot).toLowerCase() !==
          normalizeSlashes(outer.aiRoot).toLowerCase()
      ) {
        diagnostics.push({
          kind: "overlapping-ai-root",
          mappingId: inner.id,
          mappingName: inner.name,
          message:
            `Mapping "${inner.name}" syncs the AI path "${inner.aiRoot}", which sits ` +
            `inside "${outer.aiRoot}" synced by mapping "${outer.name}". Prefer moving ` +
            `one path out of the other.`,
        });
      }
    }
  }

  return diagnostics;
}
