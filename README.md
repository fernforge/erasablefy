# erasablefy

Rewrite the three TypeScript constructs that crash under Node's type stripping — `enum`, value `namespace`, and constructor parameter-properties — into equivalent erasable syntax, in place, with runtime behavior preserved.

```bash
npx erasablefy --write "src/**/*.ts"
```

## The problem this solves

Node 24 LTS runs `.ts` files directly by stripping the types out. Node 26 went further and **removed** `--experimental-transform-types` ([nodejs/node#61803](https://github.com/nodejs/node/pull/61803)) — the flag that used to compile enums and parameter-properties. There is no replacement and none is planned.

So the moment a module containing an `enum`, a value `namespace`, or a `constructor(private x)` actually executes, you get:

```
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: Enum is not supported in strip-only mode
```

It passes `tsc`. It passes install. It blows up at runtime, on the one code path that touches the construct. `tsc --erasableSyntaxOnly` (TS 5.8) will *flag* every offender, but the fix has been manual up to now. erasablefy is the fix.

## Before / after

```ts
// before — throws ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX under node --strip-types
enum Dir { Up, Down, Left, Right }

class Point {
  constructor(public readonly x: number, private y = 5) {}
}
```

```ts
// after — plain runtime code, strips cleanly, same behavior
const Dir = {
  "Up": 0, "Down": 1, "Left": 2, "Right": 3,
  "0": "Up", "1": "Down", "2": "Left", "3": "Right",
} as const;
type Dir = 0 | 1 | 2 | 3;

class Point {
  public readonly x: number;
  private y: number;
  constructor(x: number, y = 5) {
    this.x = x;
    this.y = y;
  }
}
```

Note the reverse-mapping keys (`"2": "Left"`). Numeric enums have them at runtime, so `Dir[2] === "Left"` keeps working — a naive `as const` object would silently drop that and change behavior. erasablefy keeps it.

## What it rewrites

| Construct | Rewrite |
| --- | --- |
| `enum` (string, numeric, mixed) | `as const` object + value-union `type`, with numeric reverse mapping |
| value `namespace` | `const N = (() => { ... return {...} })()` — keeps non-exported locals and closures |
| constructor parameter-properties | explicit field declaration + assignment in the constructor body (after `super()`) |

## What it refuses to touch (and tells you why)

A codemod that silently changes runtime behavior is worse than a manual fix. When erasablefy can't prove a transform is safe, it leaves the code alone and reports it:

- `const enum` — inlined at each use site; the object form has different semantics
- enum members with computed values (`A = B << 1`)
- enums or namespaces that are merged across declarations
- namespaces with a nested namespace, `import =`, or `export =`

Fix those by hand, or restructure and re-run.

## Usage

```bash
# preview (default glob: src/**/*.ts)
npx erasablefy "src/**/*.ts"

# apply in place
npx erasablefy --write "src/**/*.ts"

# CI gate: exit 1 if anything still needs rewriting or manual review
npx erasablefy --check "src/**/*.ts"
```

Run your formatter afterward — erasablefy edits the AST and doesn't try to guess your Prettier config.

## GitHub Action

Gate CI so no non-erasable syntax lands on a branch you run with `node --strip-types`:

```yaml
# .github/workflows/erasable.yml
name: erasable-check
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: fernforge/erasablefy@v1
        with:
          globs: "src/**/*.ts"
```

## Programmatic API

```ts
import { transformText, transformFiles } from "erasablefy";

const { code, result } = transformText(`enum E { A, B }`);
// result.changes  -> [{ kind: "enum", name: "E", line: 1 }]
// result.skips    -> [{ kind, name, line, reason }]
```

## Scope

This handles the deterministic, mechanical rewrites. It does not resolve path aliases, emit decorator metadata, or bundle — if you rely on those you still need a build step (`tsc`, `tsx`, `esbuild`). It's aimed at the code that is *otherwise* ready to run on native type stripping and only trips on these three constructs.

## License

MIT

---

Built by an autonomous agent; a human reviewed it before release.
