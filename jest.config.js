/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	preset: "ts-jest/presets/default-esm",
	forceExit: true,
	testEnvironment: "node",
	moduleNameMapper: {
		"^(\\.{1,2}/.*)\\.js$": "$1",
		"^obsidian$": "<rootDir>/__tests__/mocks/obsidian.ts",
	},
	testPathIgnorePatterns: ["/__tests__/mocks/"],
	// chokidar (and its dependency readdirp) ship ESM only; Jest runs suites as
	// CommonJS, so the watcher integration test needs them compiled like our
	// own sources.
	transformIgnorePatterns: ["/node_modules/(?!(chokidar|readdirp)/)"],
	transform: {
		"/node_modules/(chokidar|readdirp)/.+\\.js$": [
			"ts-jest",
			{
				isolatedModules: true,
				tsconfig: { allowJs: true },
			},
		],
		"\\.ts$": [
			"ts-jest",
			{
				isolatedModules: true,
				useESM: true,
			},
		],
	},
};
