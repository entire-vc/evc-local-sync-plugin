# Example Mapping — EVC Local Sync

## Quick Setup

After installing the plugin, create your first mapping in Obsidian:

**Settings → EVC Local Sync → Add Mapping**

| Field | Example Value |
|-------|---------------|
| **Name** | My App |
| **AI project path** | `~/projects/my-app` |
| **Obsidian folder** | `Projects/my-app/docs` |
| **Docs subfolder** | `docs` |
| **Direction** | Bidirectional |
| **Auto-sync** | On change |

This maps your repo's `~/projects/my-app/docs/` to `Projects/my-app/docs/` in your Obsidian vault.

## Recommended /docs structure

```
docs/
├── PRD.md              # Product requirements (edit in Obsidian)
├── architecture.md     # Technical decisions (edit in IDE or Obsidian)
├── ROADMAP.md          # Work plan and task status
└── specs/              # Feature specs
    ├── auth.md
    └── payments.md
```

## Tips

- **Start with manual sync** — run a few dry-runs first to verify everything looks right
- **Use Obsidian for specs** — write PRD, architecture docs, and specs in Obsidian where you have full Markdown tooling
- **Let AI update changelogs** — your agent can write to `/docs/changelog.md` and it syncs to Obsidian automatically
- **One mapping per project** — keep each repo's docs in a separate vault folder
- **Exclude build artifacts** — add patterns like `node_modules`, `.git`, `dist` to exclude list (default excludes already cover these)

## Conflict Resolution

When the same file is edited on both sides:

| Strategy | When to use |
|----------|-------------|
| **Newer wins** | Default. Safe for most workflows. |
| **Always ask** | When you want full control over every conflict. |
| **AI wins** | When agent output is authoritative (e.g., auto-generated docs). |
| **Obsidian wins** | When Obsidian is the source of truth (e.g., PRD, specs). |

Set per-mapping overrides in the mapping settings if different projects need different strategies.
