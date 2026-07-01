import {
  EnumDeclaration,
  Node,
  SyntaxKind,
} from "ts-morph";
import { Change, Skip } from "./types.js";

type MemberValue = { name: string; value: number | string; numeric: boolean };

function numericLiteralValue(init: Node): number | undefined {
  if (Node.isNumericLiteral(init)) return init.getLiteralValue();
  // -N is a prefix unary expression, not a numeric literal.
  if (Node.isPrefixUnaryExpression(init) && init.getOperatorToken() === SyntaxKind.MinusToken) {
    const operand = init.getOperand();
    if (Node.isNumericLiteral(operand)) return -operand.getLiteralValue();
  }
  return undefined;
}

/**
 * Rewrite `enum` into an `as const` object plus a value-union type alias.
 * Numeric members keep their reverse mapping (E[0] === "A") so runtime
 * behaviour matches tsc's emit exactly. Anything we cannot prove safe is
 * skipped and reported rather than mis-transformed.
 */
export function transformEnum(
  decl: EnumDeclaration,
  changes: Change[],
  skips: Skip[],
): void {
  const name = decl.getName();
  const line = decl.getStartLineNumber();
  const skip = (reason: string) => skips.push({ kind: "enum", name, line, reason });

  if (decl.isConstEnum()) {
    skip("const enum is inlined at every use site; remove `const` or migrate the call sites by hand");
    return;
  }

  // Declaration merging (enum split across blocks, or merged with a namespace/function).
  const sym = decl.getSymbol();
  if (sym && sym.getDeclarations().length > 1) {
    skip("merged declaration (enum appears more than once, or is merged with a namespace); merge by hand");
    return;
  }

  const members: MemberValue[] = [];
  let auto = 0;
  let autoValid = true;

  for (const m of decl.getMembers()) {
    const mName = m.getName();
    const init = m.getInitializer();
    if (!init) {
      if (!autoValid) {
        skip(`member "${mName}" auto-increments after a string member (TypeScript itself rejects this)`);
        return;
      }
      members.push({ name: mName, value: auto, numeric: true });
      auto += 1;
      continue;
    }
    const num = numericLiteralValue(init);
    if (num !== undefined) {
      members.push({ name: mName, value: num, numeric: true });
      auto = num + 1;
      autoValid = true;
      continue;
    }
    if (Node.isStringLiteral(init)) {
      members.push({ name: mName, value: init.getLiteralValue(), numeric: false });
      autoValid = false;
      continue;
    }
    skip(`member "${mName}" has a computed value (${init.getText()}); convert this enum by hand`);
    return;
  }

  if (members.length === 0) {
    skip("empty enum has no runtime equivalent; delete it or convert by hand");
    return;
  }

  const isExported = decl.isExported();
  const isDefault = decl.isDefaultExport();
  if (isDefault) {
    skip("default-exported enum; convert by hand");
    return;
  }

  const lit = (v: number | string) => (typeof v === "number" ? String(v) : JSON.stringify(v));

  const forward = members.map((m) => `  ${JSON.stringify(m.name)}: ${lit(m.value)},`);
  // Reverse mapping only for numeric members, matching tsc emit. Keys are quoted
  // so negative and numeric keys stay valid object literals; JS coerces on lookup.
  const reverse = members
    .filter((m) => m.numeric)
    .map((m) => `  ${JSON.stringify(String(m.value))}: ${JSON.stringify(m.name)},`);

  const objectBody = [...forward, ...reverse].join("\n");
  const valueUnion = [...new Set(members.map((m) => lit(m.value)))].join(" | ");

  const exp = isExported ? "export " : "";
  const replacement =
    `${exp}const ${name} = {\n${objectBody}\n} as const;\n` +
    `${exp}type ${name} = ${valueUnion};`;

  decl.replaceWithText(replacement);
  changes.push({ kind: "enum", name, line });
}
