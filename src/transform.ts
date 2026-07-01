import { Project, SourceFile, SyntaxKind } from "ts-morph";
import { FileResult } from "./types.js";
import { transformEnum } from "./enum.js";
import { transformNamespace } from "./namespace.js";
import { transformParameterProperties } from "./paramProps.js";

export function runOnSourceFile(sf: SourceFile): FileResult {
  const changes: FileResult["changes"] = [];
  const skips: FileResult["skips"] = [];

  // Order matters: mutate classes and enums (in-place / local replaces) before
  // wrapping namespaces, so a namespace's IIFE text reflects the inner edits.
  for (const cls of sf.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
    if (!cls.wasForgotten()) transformParameterProperties(cls, changes, skips);
  }
  for (const en of sf.getDescendantsOfKind(SyntaxKind.EnumDeclaration)) {
    if (!en.wasForgotten()) transformEnum(en, changes, skips);
  }
  for (const ns of sf.getDescendantsOfKind(SyntaxKind.ModuleDeclaration)) {
    if (!ns.wasForgotten()) transformNamespace(ns, changes, skips);
  }

  return { changes, skips };
}

/** Transform a single source string. Used by tests and programmatic callers. */
export function transformText(code: string, filePath = "input.ts"): {
  code: string;
  result: FileResult;
} {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile(filePath, code, { overwrite: true });
  const result = runOnSourceFile(sf);
  return { code: sf.getFullText(), result };
}

export interface FileOutcome extends FileResult {
  filePath: string;
  changed: boolean;
  newText: string;
}

/** Transform files on disk (glob-resolved paths). Does not write unless the caller does. */
export function transformFiles(paths: string[]): FileOutcome[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });
  const outcomes: FileOutcome[] = [];
  for (const p of paths) {
    const sf = project.addSourceFileAtPath(p);
    const original = sf.getFullText();
    const result = runOnSourceFile(sf);
    const newText = sf.getFullText();
    outcomes.push({
      ...result,
      filePath: p,
      changed: newText !== original,
      newText,
    });
    // Drop from project so a later file cannot see stale cross-file state.
    project.removeSourceFile(sf);
  }
  return outcomes;
}
