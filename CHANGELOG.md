# Changelog

All notable changes to EVC Local Sync plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.7] - 2026-06-24

### Fixed
- Community review: replace all `activeWindow.*` timer calls with `window.*` equivalents (popout-window compatibility)
- Community review: replace bare `setTimeout`/`clearTimeout` calls with `window.*` equivalents
- Community review: remove CSS `:has()` selector — add `evc-log-modal` class to modal container instead
- Community review: remove `!important` declarations — raise specificity or use class-based selectors
- Community review: replace `text-decoration` shorthand with `text-decoration-line` longhand

## [1.2.6] - 2026-06-24

### Fixed
- Release workflow: restore manifest.json after build to prevent version clobber

## [1.0.0] - 2025-01-30

### Added
- Initial release
- Bidirectional sync between AI projects and Obsidian vault
- Multiple sync modes: manual, on-change, on-startup, scheduled
- Conflict resolution strategies: newer-wins, ai-wins, obsidian-wins, always-ask
- Dry-run preview mode
- File watching with configurable debounce (chokidar-based)
- Symlink support
- Backup creation before overwriting
- Import/Export configuration
- Detailed sync logging with CSV export
- Status bar indicator with sync status
- Ribbon icon for quick sync access
- Support for .md, .canvas, .excalidraw.md files
- Custom exclusion patterns
- Auto-sync notifications (toggleable)
- Backup cleanup on disable option
