#!/usr/bin/env node
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const generated = await mkdtemp(join(root, ".dist-check-"));

const listFiles = async (directory, base = directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? listFiles(path, base)
        : [relative(base, path)];
    }),
  );
  return files.flat().sort();
};

const collectExportTargets = (value) => {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(collectExportTargets);
};

try {
  await execFileAsync(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "-p",
      join(root, "tsconfig.build.json"),
      "--outDir",
      generated,
    ],
    { cwd: root },
  );

  const [committedFiles, generatedFiles] = await Promise.all([
    listFiles(dist),
    listFiles(generated),
  ]);
  const committedSet = new Set(committedFiles);
  const generatedSet = new Set(generatedFiles);
  const missing = generatedFiles.filter((file) => !committedSet.has(file));
  const unexpected = committedFiles.filter((file) => !generatedSet.has(file));
  const changed = [];

  for (const file of generatedFiles) {
    if (!committedSet.has(file)) continue;
    const [committed, current] = await Promise.all([
      readFile(join(dist, file)),
      readFile(join(generated, file)),
    ]);
    if (!committed.equals(current)) changed.push(file);
  }

  if (missing.length || unexpected.length || changed.length) {
    const details = [
      ...missing.map((file) => `missing: dist/${file}`),
      ...unexpected.map((file) => `unexpected: dist/${file}`),
      ...changed.map((file) => `changed: dist/${file}`),
    ].join("\n");
    throw new Error(
      `committed dist does not match pnpm build:\n${details}\nRun pnpm build and commit dist.`,
    );
  }

  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const targets = [...new Set(collectExportTargets(packageJson.exports))];
  const missingTargets = [];
  for (const target of targets) {
    if (!target.startsWith("./")) {
      missingTargets.push(`${target} (must be package-relative)`);
      continue;
    }
    try {
      const targetStat = await stat(join(root, target));
      if (!targetStat.isFile()) missingTargets.push(target);
    } catch {
      missingTargets.push(target);
    }
  }
  if (missingTargets.length) {
    throw new Error(
      `package exports reference missing files:\n${missingTargets.join("\n")}`,
    );
  }

  console.log(
    `committed dist is current and ${targets.length} export targets exist (${generatedFiles.length} generated files)`,
  );
} finally {
  await rm(generated, { recursive: true, force: true });
}
