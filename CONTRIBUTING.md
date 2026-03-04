# Contributing to EVC Local Sync

Thanks for your interest in contributing! This plugin helps keep Obsidian docs and AI project folders in sync.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/my-feature`

## Development

```bash
# Development build with watch mode
npm run dev

# Production build
npm run build

# Lint
npm run lint
```

### Testing in Obsidian

1. Build the plugin: `npm run build`
2. Copy `main.js`, `styles.css`, and `manifest.json` to your vault's `.obsidian/plugins/evc-local-sync/`
3. Enable the plugin in Obsidian Settings > Community Plugins

## Pull Requests

1. Create a branch from `main`
2. Make your changes
3. Ensure `npm run build` succeeds with no errors
4. Ensure `npm run lint` passes
5. Write a clear PR description explaining what and why
6. Submit the PR

## Reporting Bugs

Use the [Bug Report](https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=bug-report.yml) issue template.

## Requesting Features

Use the [Feature Request](https://github.com/entire-vc/evc-local-sync-plugin/issues/new?template=feature-request.yml) issue template.

## Code Style

- TypeScript with strict mode
- No React/Svelte — vanilla DOM with Obsidian API
- Follow existing patterns in the codebase
- Keep changes focused and minimal

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
