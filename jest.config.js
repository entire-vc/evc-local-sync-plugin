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
	transform: {
		"\\.ts$": [
			"ts-jest",
			{
				isolatedModules: true,
				useESM: true,
			},
		],
	},
};
