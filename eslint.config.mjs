import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        NodeJS: "readonly",
      },
    },
    rules: {
      // EVC is our brand acronym; skip strings starting with "EVC"
      "obsidianmd/ui/sentence-case": ["error", {
        ignoreRegex: ["^EVC", "^node_modules"],
      }],
    },
  },
]);
