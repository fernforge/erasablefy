import { ModuleDeclaration, ModuleDeclarationKind, Node } from "ts-morph";
import { Change, Skip } from "./types.js";

/**
 * Rewrite a value `namespace` into `const N = (() => { ... return {...}; })()`.
 * The IIFE preserves non-exported locals and closures, matching how tsc emits
 * a namespace. Type-only namespaces are already erasable, so they are left
 * alone. Anything with merging, nesting, or import/export-equals is skipped.
 */
export function transformNamespace(
  ns: ModuleDeclaration,
  changes: Change[],
  skips: Skip[],
): void {
  const name = ns.getName();
  const line = ns.getStartLineNumber();
  const skip = (reason: string) => skips.push({ kind: "namespace", name, line, reason });

  // `declare namespace` / `module "x"` are ambient — no runtime emit.
  if (ns.hasDeclareKeyword() || ns.getDeclarationKind() === ModuleDeclarationKind.Global) return;
  if (ns.getName().includes(".")) {
    skip("dotted namespace name (namespace A.B); flatten it by hand");
    return;
  }

  const sym = ns.getSymbol();
  if (sym && sym.getDeclarations().length > 1) {
    skip("merged declaration (namespace appears more than once, or merges with a function/class); merge by hand");
    return;
  }

  const body = ns.getBody();
  if (!body || !Node.isModuleBlock(body)) {
    skip("namespace has no statement block; convert by hand");
    return;
  }

  const statements = body.getStatements();
  const exportedNames: string[] = [];
  let hasValue = false;

  for (const stmt of statements) {
    if (Node.isModuleDeclaration(stmt)) {
      skip("contains a nested namespace; convert the inner namespace first");
      return;
    }
    if (Node.isEnumDeclaration(stmt)) {
      skip("contains an enum; convert the enum on its own, then re-run");
      return;
    }
    if (Node.isImportEqualsDeclaration(stmt) || Node.isExportAssignment(stmt)) {
      skip("uses import-equals or export-assignment; convert by hand");
      return;
    }

    const exported = Node.isExportable(stmt) && stmt.hasExportKeyword();

    if (Node.isVariableStatement(stmt)) {
      hasValue = true;
      if (exported) {
        for (const d of stmt.getDeclarations()) {
          const nameNode = d.getNameNode();
          if (!Node.isIdentifier(nameNode)) {
            skip("exports a destructured binding; convert by hand");
            return;
          }
          exportedNames.push(nameNode.getText());
        }
      }
    } else if (Node.isFunctionDeclaration(stmt) || Node.isClassDeclaration(stmt)) {
      hasValue = true;
      if (exported) {
        const n = stmt.getName();
        if (!n) {
          skip("exports an unnamed declaration; convert by hand");
          return;
        }
        exportedNames.push(n);
      }
    }
    // interfaces / type aliases are erased anyway — keep them as harmless locals.
  }

  if (!hasValue) return; // type-only namespace: already erasable, nothing to do.

  if (exportedNames.length === 0) {
    skip("namespace exports no values; convert by hand");
    return;
  }

  const inner = statements
    .map((s) => s.getText().replace(/^export\s+/, ""))
    .map((t) => "  " + t.split("\n").join("\n  "))
    .join("\n");

  const returnObj = `  return { ${exportedNames.join(", ")} };`;
  const exp = ns.isExported() ? "export " : "";
  const replacement =
    `${exp}const ${name} = (() => {\n${inner}\n${returnObj}\n})();`;

  ns.replaceWithText(replacement);
  changes.push({ kind: "namespace", name, line });
}
