## Documentation Sync Rules

This project uses [EVC Local Sync](https://github.com/entire-vc/evc-local-sync-plugin) to keep `/docs` in sync with an Obsidian vault.

### When working with /docs:
- Always read the current state of files in `/docs` before modifying
- After changes to specs or documentation, update the corresponding file in `/docs`
- Use clear commit messages referencing which doc was updated
- Do NOT delete files from `/docs` without explicit confirmation

### File structure:
- `/docs/PRD.md` — Product Requirements (source of truth in Obsidian)
- `/docs/architecture.md` — Technical architecture decisions
- `/docs/changelog.md` — Auto-updated changelog

### Sync behavior:
- Changes in `/docs` are automatically synced to Obsidian vault
- Changes in Obsidian are automatically synced to `/docs`
- Conflicts are resolved by keeping both copies (manual merge needed)
