# Troubleshooting

Common issues and solutions for EVC Local Sync.

---

## Sync not detecting changes

**Symptom:** Files changed but sync shows "no changes found."

**Solutions:**
- Check that the mapping is **enabled** in settings
- Verify both paths exist and are accessible
- Ensure the file type is in the allowed list (default: `.md`, `.canvas`, `.excalidraw.md`)
- Check **exclude patterns** — your file path might match an exclusion

---

## Case sensitivity (macOS / Windows)

**Symptom:** Duplicate files appear, or sync creates new files instead of updating existing ones.

**Cause:** macOS and Windows filesystems are case-insensitive (`docs/` and `Docs/` are the same folder), but sync paths are strings that can differ in case.

**Solution:** Make sure the folder names in your mapping match the actual casing on disk. The plugin normalizes case on macOS/Windows automatically since v1.1.0, but mismatched paths in the mapping config itself can still cause issues.

---

## File watcher missed events

**Symptom:** Auto-sync doesn't trigger after saving a file.

**Solutions:**
- Increase the **debounce interval** in settings (default: 3000ms). Rapid saves within the debounce window are batched into one sync
- Some editors use "atomic saves" (write to temp file, then rename). The watcher should detect this, but if not, try a manual sync first to confirm the mapping works
- Restart the plugin: *Settings → Community plugins → toggle off/on*

---

## Rapid edits and save conflicts

**Symptom:** Unexpected conflict prompts when editing the same file quickly in both locations.

**Solution:**
- Avoid editing the same file in both Obsidian and your IDE simultaneously
- If you get frequent conflict prompts, switch to **"Newer file wins"** conflict resolution for that mapping
- Use **dry-run** to preview what will happen before syncing

---

## Renames and moves

**Symptom:** Renamed or moved files appear as "new file + deleted file" instead of a rename.

**Cause:** The plugin tracks files by path, not by content. A rename looks like a deletion of the old path and creation of a new path.

**What happens:**
- The new file syncs normally (copied to the other side)
- The old file is detected as deleted and synced (removed from the other side) if deletion sync is enabled

**Tip:** If you rename a folder that contains many files, run a **dry-run** first to verify the expected changes.

---

## Symlinks not followed

**Symptom:** Symlinked folders or files are skipped during sync.

**Solution:** Enable **Follow symlinks** in the plugin settings. This is disabled by default for safety.

---

## Sync takes too long

**Symptom:** Large projects cause noticeable delay during sync.

**Solutions:**
- Narrow the **docs subdirectory** — sync only `docs/` instead of the entire project
- Add exclusion patterns for large or irrelevant folders
- Use **manual sync** instead of auto-sync to control when it runs

---

## Plugin conflicts

**Symptom:** Unexpected behavior when using alongside other sync plugins.

**Known compatible:**
- Obsidian Sync
- Obsidian Git
- Self-hosted LiveSync

**Tips:**
- Avoid syncing the same folder with multiple sync tools
- If using Obsidian Git, add your AI project path to `.gitignore` in the vault (or vice versa)

---

## Backup and recovery

The plugin creates backups before overwriting files (when enabled in settings). Backups are stored alongside the original file with a timestamp suffix.

If something goes wrong:
1. Check the **sync log** (status bar → View logs) for what was changed
2. Look for `.bak` files in the affected directory
3. Use git history in your project repo to recover previous versions

---

## Still stuck?

- [Report a bug](https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=bug-report.yml)
- [Report a conflict case](https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=conflict-case.yml)
- [Community discussions](https://github.com/entire-vc/.github/discussions)
