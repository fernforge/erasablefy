#!/usr/bin/env node
import { Project } from "ts-morph";
import { runOnSourceFile } from "./transform.js";
import type { Change, Skip } from "./types.js";

interface Options {
  write: boolean;
  check: boolean;
  globs: string[];
}

const HELP = `erasablefy — rewrite non-erasable TypeScript so .ts runs on Node type stripping

Usage:
  erasablefy [globs...]        Preview changes (default: "src/**/*.ts")
  erasablefy --write [globs]   Apply changes in place
  erasablefy --check [globs]   Exit 1 if any file would change (CI gate)

What it rewrites:
  enum                  -> const object (as const) + value-union type
  value namespace       -> const N = (() => { ... })()
  parameter properties  -> explicit field + constructor assignment

Constructs it cannot prove safe (const enum, computed enum members, merged or
nested namespaces, ...) are left untouched and reported so you can fix them.

Flags:
  --write        write changes to disk
  --check        report only; exit non-zero when changes are needed
  -h, --help     show this help
`;

function parseArgs(argv: string[]): Options {
  const opts: Options = { write: false, check: false, globs: [] };
  for (const a of argv) {
    if (a === "--write") opts.write = true;
    else if (a === "--check") opts.check = true;
    else if (a === "-h" || a === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (a.startsWith("-")) {
      process.stderr.write(`erasablefy: unknown flag ${a}\n`);
      process.exit(2);
    } else opts.globs.push(a);
  }
  if (opts.globs.length === 0) opts.globs = ["src/**/*.ts"];
  return opts;
}

const KIND_LABEL: Record<string, string> = {
  enum: "enum",
  namespace: "namespace",
  "parameter-property": "parameter properties",
};

function fmtChange(c: Change): string {
  return `    ${c.line}: rewrote ${KIND_LABEL[c.kind]} ${c.name}`;
}
function fmtSkip(s: Skip): string {
  return `    ${s.line}: skipped ${KIND_LABEL[s.kind]} ${s.name} — ${s.reason}`;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });

  let files;
  try {
    files = project.addSourceFilesAtPaths(opts.globs);
  } catch (e) {
    process.stderr.write(`erasablefy: ${(e as Error).message}\n`);
    process.exit(2);
  }

  if (files.length === 0) {
    process.stderr.write(`erasablefy: no files matched ${opts.globs.join(", ")}\n`);
    process.exit(1);
  }

  let changedFiles = 0;
  let totalChanges = 0;
  let totalSkips = 0;

  for (const sf of files) {
    const original = sf.getFullText();
    const { changes, skips } = runOnSourceFile(sf);
    const changed = sf.getFullText() !== original;
    if (changes.length === 0 && skips.length === 0) continue;

    const rel = sf.getFilePath();
    process.stdout.write(`  ${rel}\n`);
    for (const c of changes) process.stdout.write(fmtChange(c) + "\n");
    for (const s of skips) process.stdout.write(fmtSkip(s) + "\n");

    totalChanges += changes.length;
    totalSkips += skips.length;
    if (changed) {
      changedFiles += 1;
      if (opts.write) await sf.save();
    }
  }

  const verb = opts.write ? "rewrote" : "would rewrite";
  process.stdout.write(
    `\nerasablefy: ${verb} ${totalChanges} construct(s) in ${changedFiles} file(s)` +
      (totalSkips ? `, ${totalSkips} needs manual review` : "") +
      ".\n",
  );

  if (opts.check && changedFiles > 0) process.exit(1);
  // Skips are a hard signal too: they represent syntax Node still can't strip.
  if (opts.check && totalSkips > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`erasablefy: ${(e as Error).stack ?? e}\n`);
  process.exit(2);
});
