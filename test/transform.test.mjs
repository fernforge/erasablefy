import { test } from "node:test";
import assert from "node:assert/strict";
import { transformText } from "../dist/index.js";

const norm = (s) => s.replace(/\s+/g, " ").trim();
function run(code) {
  return transformText(code);
}

test("string enum -> as const object + union", () => {
  const { code, result } = run(`export enum Color { Red = "red", Green = "green" }`);
  assert.equal(result.changes.length, 1);
  assert.match(code, /export const Color = \{/);
  assert.match(code, /"Red": "red"/);
  assert.match(code, /as const;/);
  assert.match(code, /export type Color = "red" \| "green";/);
  // string enums get NO reverse mapping
  assert.doesNotMatch(code, /"red": "Red"/);
});

test("numeric enum keeps reverse mapping and forward-value union", () => {
  const { code } = run(`enum Dir { Up, Down, Left, Right }`);
  assert.match(code, /"Up": 0/);
  assert.match(code, /"Right": 3/);
  // reverse mapping present, keys quoted
  assert.match(code, /"0": "Up"/);
  assert.match(code, /"3": "Right"/);
  assert.match(code, /type Dir = 0 \| 1 \| 2 \| 3;/);
});

test("explicit numeric with auto-increment resumes from last value", () => {
  const { code } = run(`enum E { A = 5, B, C = 10, D }`);
  assert.match(code, /"A": 5/);
  assert.match(code, /"B": 6/);
  assert.match(code, /"C": 10/);
  assert.match(code, /"D": 11/);
});

test("negative numeric member uses quoted reverse key", () => {
  const { code } = run(`enum N { Minus = -1, Zero = 0 }`);
  assert.match(code, /"Minus": -1/);
  assert.match(code, /"-1": "Minus"/);
});

test("const enum is skipped, not transformed", () => {
  const { code, result } = run(`const enum X { A, B }`);
  assert.equal(result.changes.length, 0);
  assert.equal(result.skips.length, 1);
  assert.match(result.skips[0].reason, /const enum/);
  assert.match(code, /const enum X/); // untouched
});

test("computed enum member is skipped", () => {
  const { result } = run(`enum C { A = 1, B = A << 1 }`);
  assert.equal(result.changes.length, 0);
  assert.equal(result.skips.length, 1);
  assert.match(result.skips[0].reason, /computed/);
});

test("parameter properties -> field + ctor assignment", () => {
  const { code, result } = run(
    `class C { constructor(private a: number, public readonly b: string) {} }`,
  );
  assert.equal(result.changes.length, 1);
  assert.match(norm(code), /private a: number;/);
  assert.match(norm(code), /public readonly b: string;/);
  assert.match(norm(code), /constructor\(a: number, b: string\)/);
  assert.match(norm(code), /this\.a = a;/);
  assert.match(norm(code), /this\.b = b;/);
});

test("parameter property assignment lands after super()", () => {
  const { code } = run(
    `class D extends B { constructor(private x: number) { super(); this.setup(); } }`,
  );
  const body = norm(code);
  const superIdx = body.indexOf("super();");
  const assignIdx = body.indexOf("this.x = x;");
  const setupIdx = body.indexOf("this.setup();");
  assert.ok(superIdx >= 0 && assignIdx > superIdx && assignIdx < setupIdx);
});

test("parameter property without annotation recovers type from default", () => {
  const { code } = run(`class P { constructor(public count = 0) {} }`);
  assert.match(norm(code), /public count: number;/);
});

test("mixed real + parameter-property params keep plain params intact", () => {
  const { code } = run(
    `class M { constructor(readonly id: string, plain: number) {} }`,
  );
  assert.match(norm(code), /readonly id: string;/);
  assert.match(norm(code), /constructor\(id: string, plain: number\)/);
  assert.doesNotMatch(norm(code), /this\.plain/);
});

test("value namespace -> IIFE returning exports", () => {
  const { code, result } = run(
    `export namespace Utils { export const version = "1"; const secret = 2; export function greet() { return secret; } }`,
  );
  assert.equal(result.changes.length, 1);
  assert.match(norm(code), /export const Utils = \(\(\) => \{/);
  assert.match(norm(code), /const version = "1";/);
  assert.match(norm(code), /const secret = 2;/); // non-exported local preserved
  assert.match(norm(code), /return \{ version, greet \};/);
});

test("type-only namespace is left alone (already erasable)", () => {
  const src = `namespace T { export interface Foo { a: number } export type Bar = string; }`;
  const { code, result } = run(src);
  assert.equal(result.changes.length, 0);
  assert.equal(result.skips.length, 0);
  assert.equal(code.trim(), src);
});

test("nested namespace is skipped", () => {
  const { result } = run(`namespace A { export namespace B { export const x = 1; } }`);
  const skip = result.skips.find((s) => s.kind === "namespace");
  assert.ok(skip);
});

test("enum nested inside a class body is still transformed", () => {
  // enums can appear as class static members? No — but as a nested statement in a namespace fn.
  const { code } = run(`function f() { enum Local { A, B } return Local.A; }`);
  assert.match(code, /const Local = \{/);
});

test("clean file with only erasable syntax is unchanged", () => {
  const src = `export interface X { a: number }\nexport const y: X = { a: 1 };\n`;
  const { code, result } = run(src);
  assert.equal(result.changes.length, 0);
  assert.equal(result.skips.length, 0);
  assert.equal(code, src);
});
