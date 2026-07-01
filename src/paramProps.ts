import {
  ClassDeclaration,
  ConstructorDeclaration,
  Node,
  ParameterDeclaration,
  PropertyDeclarationStructure,
  Scope,
  StructureKind,
  SyntaxKind,
} from "ts-morph";
import { Change, Skip } from "./types.js";

const ACCESS = new Set([
  SyntaxKind.PublicKeyword,
  SyntaxKind.PrivateKeyword,
  SyntaxKind.ProtectedKeyword,
]);

function isParameterProperty(param: ParameterDeclaration): boolean {
  return param.getModifiers().some((m) => {
    const k = m.getKind();
    return ACCESS.has(k) || k === SyntaxKind.ReadonlyKeyword || k === SyntaxKind.OverrideKeyword;
  });
}

function scopeOf(param: ParameterDeclaration): Scope | undefined {
  for (const m of param.getModifiers()) {
    if (m.getKind() === SyntaxKind.PublicKeyword) return Scope.Public;
    if (m.getKind() === SyntaxKind.PrivateKeyword) return Scope.Private;
    if (m.getKind() === SyntaxKind.ProtectedKeyword) return Scope.Protected;
  }
  return undefined;
}

function fieldType(param: ParameterDeclaration): string | undefined {
  const node = param.getTypeNode();
  if (node) return node.getText();
  // No annotation: recover the type tsc would infer (e.g. from a default value).
  try {
    const text = param.getType().getText(param);
    if (text && !text.includes("import(") && text !== "any") return text;
  } catch {
    /* fall through */
  }
  return undefined;
}

function firstStatementIsSuperCall(ctor: ConstructorDeclaration): boolean {
  const first = ctor.getStatements()[0];
  if (!first || !Node.isExpressionStatement(first)) return false;
  const expr = first.getExpression();
  return Node.isCallExpression(expr) && expr.getExpression().getKind() === SyntaxKind.SuperKeyword;
}

export function transformParameterProperties(
  cls: ClassDeclaration,
  changes: Change[],
  _skips: Skip[],
): void {
  const ctor = cls.getConstructors().find((c) => c.getBody() !== undefined);
  if (!ctor) return;

  const props = ctor.getParameters().filter(isParameterProperty);
  if (props.length === 0) return;

  const structures: PropertyDeclarationStructure[] = [];
  const assignments: string[] = [];

  for (const param of props) {
    const name = param.getName();
    structures.push({
      kind: StructureKind.Property,
      name,
      type: fieldType(param),
      scope: scopeOf(param),
      isReadonly: param.isReadonly(),
      hasOverrideKeyword: param.hasOverrideKeyword(),
    });
    assignments.push(`this.${name} = ${name};`);

    // Demote the parameter to a plain one, keeping its type and default value.
    param.setScope(undefined);
    param.setIsReadonly(false);
    param.setHasOverrideKeyword(false);
  }

  const memberIndex = cls.getMembers().indexOf(ctor);
  cls.insertProperties(memberIndex, structures);

  const insertAt = firstStatementIsSuperCall(ctor) ? 1 : 0;
  ctor.insertStatements(insertAt, assignments);

  changes.push({
    kind: "parameter-property",
    name: cls.getName() ?? "<anonymous class>",
    line: cls.getStartLineNumber(),
  });
}
