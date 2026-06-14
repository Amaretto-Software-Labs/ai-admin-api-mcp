#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2]?.trim();
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!version || !semverPattern.test(version)) {
  throw new Error(`Expected a SemVer package version, got '${version ?? ""}'.`);
}

const packagePaths = ["package.json"];

for (const path of packagePaths) {
  const pkg = readPackage(path);
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

function readPackage(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
