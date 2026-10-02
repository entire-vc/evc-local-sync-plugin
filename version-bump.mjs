import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  throw new Error("Run this script through npm version so npm_package_version is set.");
}

// Preserve each JSON file's indentation and trailing newline during a bump.
function readJSON(path) {
  const raw = readFileSync(path, "utf8");
  const indentMatch = raw.match(/^\{\r?\n([ \t]+)/);
  return {
    data: JSON.parse(raw),
    indent: indentMatch ? indentMatch[1] : "\t",
    trailingNewline: raw.endsWith("\n"),
  };
}

function writeJSON(path, { data, indent, trailingNewline }) {
  const out = JSON.stringify(data, null, indent);
  writeFileSync(path, trailingNewline ? out + "\n" : out);
}

const manifest = readJSON("manifest.json");
const manifestBeta = readJSON("manifest-beta.json");
const versions = readJSON("versions.json");

manifest.data.version = targetVersion;
manifestBeta.data.version = targetVersion;
versions.data[targetVersion] = manifest.data.minAppVersion;

writeJSON("manifest.json", manifest);
writeJSON("manifest-beta.json", manifestBeta);
writeJSON("versions.json", versions);
