#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2]?.trim();
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!version || !semverPattern.test(version)) {
  throw new Error(`Expected a SemVer package version, got '${version ?? ""}'.`);
}

const packagePaths = [
  "packages/core/package.json",
  "packages/providers/openai/package.json",
  "packages/providers/anthropic/package.json",
  "packages/mcp-server/package.json",
];

const internalPackages = new Set(packagePaths.map((path) => readPackage(path).name));

for (const path of packagePaths) {
  const pkg = readPackage(path);
  pkg.version = version;
  for (const section of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"]) {
    replaceInternalRanges(pkg[section]);
  }
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

function readPackage(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function replaceInternalRanges(dependencies) {
  if (!dependencies || typeof dependencies !== "object") {
    return;
  }
  for (const name of Object.keys(dependencies)) {
    if (internalPackages.has(name)) {
      dependencies[name] = version;
    }
  }
}
