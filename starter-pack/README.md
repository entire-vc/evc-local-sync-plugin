# EVC Local Sync — Starter Pack

Get your AI workflow running in 5 minutes.

## What's inside

```
.claude/CLAUDE.md              → Rules for Claude Code
.cursor/rules/docs-sync.mdc   → Rules for Cursor AI
.windsurfrules                 → Rules for Windsurf
docs/example-mapping.md        → Setup guide + tips
```

## Quick Start

### 1. Install Local Sync in Obsidian

Via [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install BRAT from Community Plugins
2. BRAT settings → "Add Beta Plugin" → `entire-vc/evc-local-sync-plugin`
3. Enable "EVC Local Sync to AI Agent" in Community Plugins

### 2. Copy the config for your AI tool

**Claude Code:**
```bash
cp -r .claude/ /path/to/your/project/.claude/
```

**Cursor:**
```bash
cp -r .cursor/ /path/to/your/project/.cursor/
```

**Windsurf:**
```bash
cp .windsurfrules /path/to/your/project/.windsurfrules
```

### 3. Create a mapping

In Obsidian: Settings → EVC Local Sync → Add Mapping

- **AI project path**: your repo (e.g. `~/projects/my-app`)
- **Obsidian folder**: where you want docs in your vault
- **Docs subfolder**: `docs`
- **Direction**: Bidirectional

See [docs/example-mapping.md](docs/example-mapping.md) for detailed setup guide.

### 4. Sync and go

Run your first sync, then start editing. Your AI agent reads fresh `/docs` on every request. You edit in Obsidian. Everything stays aligned.

## Links

- [EVC Local Sync plugin](https://github.com/entire-vc/evc-local-sync-plugin)
- [Landing page](https://entire.vc/local-sync)
- [Report an issue](https://github.com/entire-vc/evc-local-sync-plugin/issues)
