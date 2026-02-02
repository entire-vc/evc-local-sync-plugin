# EVC Local Sync to AI Agent

[![GitHub release](https://img.shields.io/github/v/release/entire-vc/evc-local-sync-plugin?style=flat-square)](https://github.com/entire-vc/evc-local-sync-plugin/releases)
[![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22evc-local-sync%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&style=flat-square)](https://obsidian.md/plugins?id=evc-local-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

> **[Download Latest Release (v1.0.1)](https://github.com/entire-vc/evc-local-sync-plugin/releases/latest)** | [Changelog](https://github.com/entire-vc/evc-local-sync-plugin/releases)

Obsidian plugin for **bidirectional synchronization** of documentation between Obsidian vault and AI development projects (Claude Code, Cursor AI, VS Code with AI assistants).

## The Problem

When working with AI coding assistants, documentation gets scattered:
- AI agents create technical docs in `project/docs/`
- You write specs and PRDs in Obsidian
- Manual copying leads to outdated docs and context fragmentation

## The Solution

**EVC Local Sync** automatically synchronizes `docs/` folders between your AI projects and Obsidian, ensuring a single source of truth with minimal context overhead.

## Features

- **Bidirectional sync** between AI projects and Obsidian vault
- **Multiple sync modes**: Manual, on-change, on-startup, scheduled
- **Smart conflict resolution**: Newer wins, AI wins, Obsidian wins, or always ask
- **File deletion sync** — deleted files can be synced across locations (v1.0.1)
- **Per-mapping settings** — override conflict resolution and file types per project (v1.0.1)
- **Dry-run preview** to see changes before syncing
- **File watching** with configurable debounce
- **Symlink support** for complex project structures
- **Detailed logging** with filtering and CSV export
- **Backup creation** before overwriting files
- **Import/Export** configuration for portability
- Supports **.md**, **.canvas**, **.excalidraw.md** files

## Installation

### From Community Plugins

1. Open Obsidian Settings → Community Plugins
2. Disable Safe Mode if prompted
3. Click Browse and search for "EVC Local Sync"
4. Install and enable the plugin

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/entire-vc/evc-local-sync-plugin/releases)
2. Create folder `.obsidian/plugins/evc-local-sync/` in your vault
3. Copy downloaded files to this folder
4. Enable plugin in Settings → Community Plugins

### BRAT Installation (Beta Testing)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add beta plugin: `entire-vc/evc-local-sync-plugin`
3. Enable the plugin

## Quick Start

### 1. Create a Mapping

1. Open Settings → EVC Local Sync
2. Click "Add Mapping"
3. Configure:
   - **Name**: e.g., "My Project"
   - **AI Project Path**: `/Users/you/Projects/my-app` or `~/Projects/my-app`
   - **Obsidian Folder**: Folder in your vault for this project
   - **Docs Subfolder**: Usually `docs`

### 2. Sync Your Docs

- Use the **ribbon icon** (left sidebar) for quick sync
- Or **Command Palette** → `EVC Sync: Sync All Projects`
- Or enable **auto-sync** in settings

## Commands

| Command | Description |
|---------|-------------|
| `EVC Sync: Sync All Projects` | Sync all enabled mappings |
| `EVC Sync: Sync Current Project` | Sync mapping for active file |
| `EVC Sync: Dry Run` | Preview changes without syncing |
| `EVC Sync: View Logs` | View sync history |
| `EVC Sync: Open Settings` | Open plugin settings |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Sync Mode | Manual | Manual, on-change, on-startup, scheduled |
| Scheduled Interval | 30 min | Interval for scheduled sync |
| Debounce | 3000ms | Delay before on-change sync triggers |
| Conflict Resolution | Newer wins | How to handle file conflicts |
| Create Backups | Enabled | Backup files before overwriting |
| Follow Symlinks | Disabled | Follow symbolic links during sync |
| Sync Deletions | Disabled | Sync file deletions between locations (v1.0.1) |
| Confirm Deletions | Enabled | Confirm before deleting files (v1.0.1) |
| File Types | .md, .canvas, .excalidraw.md | File extensions to sync |
| Log Retention | 7 days | How long to keep sync logs |

### Per-mapping Overrides (v1.0.1)

Each mapping can override global settings in the "Advanced settings" section:
- **Conflict resolution** — Use different strategy per project
- **File types** — Sync different file types per project
- **Exclude patterns** — Custom exclusions per project

## Conflict Resolution Strategies

| Strategy | Description |
|----------|-------------|
| **Newer wins** | File with latest modification time wins |
| **AI wins** | Always prefer AI project version |
| **Obsidian wins** | Always prefer Obsidian version |
| **Always ask** | Prompt for each conflict |

## Excluded Paths

These paths are automatically excluded from sync:

- `node_modules/`
- `.git/`
- `.obsidian/`
- `.DS_Store`
- `.space/`
- `attachments/` (optional)

Custom exclusion patterns can be added in settings.

## Compatibility

- **Obsidian**: 1.4.0+
- **Platforms**: macOS, Windows, Linux
- **Works with**: Claude Code, Cursor AI, VS Code + AI assistants
- **Compatible plugins**: Obsidian Sync, Obsidian Git, Self-hosted LiveSync

## Development

```bash
# Clone the repository
git clone https://github.com/entire-vc/evc-local-sync-plugin.git
cd evc-local-sync-plugin

# Install dependencies
npm install

# Development build (watch mode)
npm run dev

# Production build
npm run build

# Lint
npm run lint
```

### Project Structure

```
src/
├── main.ts              # Plugin entry point
├── settings.ts          # Settings tab UI
├── sync-engine.ts       # Core sync logic
├── file-watcher.ts      # File change detection
├── mapping-manager.ts   # Project mappings CRUD
├── conflict-resolver.ts # Conflict handling
├── logger.ts            # Sync logging
└── ui/
    ├── status-bar.ts    # Status bar indicator
    ├── ribbon-icon.ts   # Ribbon quick action
    └── modals/          # UI modals
```

## Troubleshooting

### "AI project path does not exist"
- Ensure the path exists and is accessible
- Use absolute paths: `/Users/you/Projects/my-app`
- Home directory shortcut works: `~/Projects/my-app`

### Files not syncing
- Check if file type is enabled in settings
- Verify the file is not in an excluded folder
- Ensure the mapping is enabled
- Run Dry Run to see what would be synced

### Auto-sync not working
- Verify sync mode is set to "On Change"
- Check if file watcher is active (status bar shows watching icon)
- Increase debounce time if changes are too rapid

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -am 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

## License

[MIT](LICENSE) © Entire VC

## Support

- **Issues**: [GitHub Issues](https://github.com/entire-vc/evc-local-sync-plugin/issues)
- **Discussions**: [GitHub Discussions](https://github.com/entire-vc/evc-local-sync-plugin/discussions)

---

Made with ❤️ for seamless AI-assisted development workflows.
