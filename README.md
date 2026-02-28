![License](https://img.shields.io/github/license/entire-vc/evc-local-sync-plugin)
![GitHub Stars](https://img.shields.io/github/stars/entire-vc/evc-local-sync-plugin)

# EVC Local Sync

[![GitHub release](https://img.shields.io/github/v/tag/entire-vc/evc-local-sync-plugin?style=flat-square)](https://github.com/entire-vc/evc-local-sync-plugin/releases)
[![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22evc-local-sync%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&style=flat-square)](https://obsidian.md/plugins?id=evc-local-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

**Keep your project `/docs` and Obsidian notes always in sync — bidirectional, local-first, no copy/paste.**

> Built for AI-assisted coding workflows (Cursor / Claude Code / Copilot):
> let AI update repo docs while your Obsidian specs stay fresh automatically.

![Demo](./assets/demo.gif)

---

## The Problem

You code with AI. Your AI writes and updates docs in `/docs`. But your Obsidian specs go stale.
Or you update specs in Obsidian, and the repo doesn't know.

**Result:** AI hallucinates from outdated context. Teammates read wrong docs. You copy-paste manually.

Local Sync fixes this: **bidirectional, automatic, local-first.**

---

## Install

### Option A — BRAT (available now, recommended)
1. Install **BRAT**: *Settings → Community plugins → Browse → "BRAT" → Install*
2. Open BRAT: *Settings → BRAT → Add beta plugin*
3. Paste repo URL: `https://github.com/entire-vc/evc-local-sync-plugin`
4. Enable: *Settings → Community plugins → EVC Local Sync → Enable*

### Option B — Community Plugins
Pending review. [Track status →](https://github.com/obsidianmd/obsidian-releases/pull/9908)

### Option C — Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/entire-vc/evc-local-sync-plugin/releases)
2. Create folder `.obsidian/plugins/evc-local-sync/` in your vault
3. Copy downloaded files to this folder
4. Enable in *Settings → Community plugins*

---

## Quickstart (3 minutes)

1. Open plugin settings → **Add mapping**
   - Vault path: `Specs/`
   - Local path: `/path/to/project/docs/`
2. Click **Sync Now**
3. *(Optional)* Enable **Auto sync** and choose a conflict strategy

✅ Changes now mirror in both directions.

> **AI Starter Pack** — pre-configured rules for Claude Code, Cursor, and Windsurf that teach your AI agent how to work with synced `/docs`.
> [Get the pack →](https://spark.entire.vc/assets/local-sync-starter-pack)

---

## Workflows

### 1 — AI writes docs → Obsidian stays fresh
AI updates `/docs` while you code → Local Sync keeps your Obsidian notes current.
No more "AI hallucinated because the spec was outdated."

### 2 — You edit in Obsidian → repo docs update for teammates and CI
Edit spec in Obsidian → sync → teammates and CI pipelines always read the latest docs.

### 3 — Dev team docs that never go stale
Connect your team's project docs to a shared vault. When any dev updates `/docs` (or AI does), the vault stays current. End the cycle of stale documentation.

---

## Key Features

- **Bidirectional sync** (vault ↔ local folders)
- **Multiple mappings** (multiple projects / subfolders)
- **Configurable conflict handling** (keep both / overwrite / prompt)
- **Auto sync** (on-change, on-startup, scheduled)
- **File deletion sync** — deleted files sync across locations
- **Per-mapping settings** — override conflict resolution and file types per project
- **Dry-run preview** — see changes before syncing
- **File watching** with configurable debounce
- **Symlink support** for complex project structures
- **Detailed logging** with filtering and CSV export
- **Backup creation** before overwriting files
- **Import/Export** configuration for portability
- Supports **.md**, **.canvas**, **.excalidraw.md** files
- **Fully local** — works offline, nothing sent to external servers

---

## Conflict Handling

Sync conflicts happen when both sides change before a sync runs.

**Recommended starting point:**
- Start with **manual sync** while testing your mapping
- Use **Keep both copies** until you're confident
- Check [`docs/Troubleshooting.md`](./docs/Troubleshooting.md) for common edge cases

---

## Comparison

| | Copy/paste | Manual export | Git submodule | **Local Sync** |
|---|---|---|---|---|
| Always current | ❌ | ❌ | partial | ✅ |
| Bidirectional | ❌ | ❌ | ❌ | ✅ |
| Conflict handling | manual | none | merge conflicts | configurable |
| Offline / private | ✅ | ✅ | ✅ | ✅ |
| Setup complexity | none | none | high | 3 steps |
| AI IDE workflow | ❌ | ❌ | partial | ✅ |

---

## Working with a Team?

Local Sync is designed for solo workflows. If you need **team collaboration** or want to **publish your vault** as a website (private, protected, or public):

→ [**EVC Team Relay**](https://github.com/entire-vc/evc-team-relay-obsidian-plugin) — self-hosted with web publish (free, bring your own VPS) or [hosted](https://entire.vc) (zero ops)

**Why teams choose Team Relay:**
- Real-time collab without Git merge conflicts
- Web publish: share vault as a beautiful website (internal wiki, client portal, or public docs)
- Flat pricing instead of $8/user/month (Notion) or $12/user/month (GitBook)

---

## Feedback

Edge cases and integration requests help make this solid:

- [Report a bug →](https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=bug-report.yml)
- [Report a conflict case →](https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=conflict-case.yml)
- [Request a feature →](https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=feature-request.yml)

---

## Troubleshooting

See [`docs/Troubleshooting.md`](./docs/Troubleshooting.md)

Common topics: renames/moves · case sensitivity (Windows/macOS) · watcher missed events · rapid edits

---

## Part of the Entire VC Toolbox

| Product | What it does | Link |
|---------|-------------|------|
| **Local Sync** ← you are here | Vault ↔ AI dev tools sync | this repo |
| **Team Relay** | Self-hosted collaboration server | [repo](https://github.com/entire-vc/evc-team-relay) |
| **Team Relay Plugin** | Obsidian plugin for Team Relay | [repo](https://github.com/entire-vc/evc-team-relay-obsidian-plugin) |
| **Spark MCP** | MCP server for AI workflow catalog | [repo](https://github.com/entire-vc/evc-spark-mcp) |
| **OpenClaw Skill** | AI agent ↔ vault access | [repo](https://github.com/entire-vc/evc-team-relay-openclaw-skill) |

---


## Community

- 🌐 [entire.vc](https://entire.vc)
- 💬 [Discussions](https://github.com/entire-vc/.github/discussions)
- 📧 in@entire.vc

## License

MIT
