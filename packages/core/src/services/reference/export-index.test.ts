/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { buildExportIndex } from './export-index.js';
import type { RipgrepLine } from './reference-service.js';

function line(file: string, text: string, isMatch = true): RipgrepLine {
  return { file, line: 1, text, isMatch };
}

describe('buildExportIndex', () => {
  it('parses declaration kinds and strips the export prefix from signatures', () => {
    const exports = buildExportIndex([
      line('index.d.ts', 'export declare function foo(a: string): void;'),
      line('index.d.ts', 'export declare abstract class Bar {'),
      line('index.d.ts', 'export interface Baz {'),
      line('index.d.ts', 'export type Qux = string;'),
      line('index.d.ts', 'export declare enum Level {'),
      line('index.d.ts', 'export declare const VERSION: string;'),
      line('index.d.ts', 'export declare namespace NS {'),
      line('index.d.ts', 'export async function later(): Promise<void> {'),
    ]);
    expect(exports.map((e) => [e.kind, e.name])).toEqual([
      ['function', 'foo'],
      ['function', 'later'],
      ['class', 'Bar'],
      ['interface', 'Baz'],
      ['type', 'Qux'],
      ['enum', 'Level'],
      ['const', 'VERSION'],
      ['namespace', 'NS'],
    ]);
    expect(exports.find((e) => e.name === 'foo')?.signature).toBe(
      'function foo(a: string): void',
    );
    expect(exports.find((e) => e.name === 'Bar')?.signature).toBe(
      'abstract class Bar',
    );
  });

  it('folds let/var declarations into const', () => {
    const exports = buildExportIndex([
      line('index.d.ts', 'export declare let counter: number;'),
      line('index.d.ts', 'export var legacy: string;'),
    ]);
    expect(exports.map((e) => e.kind)).toEqual(['const', 'const']);
  });

  it('parses default exports, named and anonymous', () => {
    const exports = buildExportIndex([
      line('a.d.ts', 'export default function main(): void;'),
      line('b.d.ts', 'export default {'),
    ]);
    expect(exports.map((e) => [e.kind, e.name])).toEqual([
      ['default', 'default'],
      ['default', 'main'],
    ]);
  });

  it('parses brace re-export lists with aliases and type prefixes', () => {
    const exports = buildExportIndex([
      line(
        'index.d.ts',
        "export { init, tx as transact, type Config } from './core';",
      ),
    ]);
    expect(exports.map((e) => e.name)).toEqual(['Config', 'init', 'transact']);
    expect(exports.every((e) => e.kind === 'reexport')).toBe(true);
    expect(exports.find((e) => e.name === 'transact')?.signature).toBe(
      'transact',
    );
  });

  it('parses namespace re-exports and ignores bare star re-exports', () => {
    const exports = buildExportIndex([
      line('index.d.ts', "export * as helpers from './helpers';"),
      line('index.d.ts', "export * from './other';"),
    ]);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toMatchObject({ name: 'helpers', kind: 'namespace' });
  });

  it('ignores context lines and non-export lines', () => {
    const exports = buildExportIndex([
      line('index.d.ts', 'export declare function real(): void;'),
      line('index.d.ts', 'export declare function ctx(): void;', false),
      line('index.d.ts', 'function internal(): void {'),
    ]);
    expect(exports.map((e) => e.name)).toEqual(['real']);
  });

  it('prefers .d.ts declarations over dist JS for the same name', () => {
    const exports = buildExportIndex([
      line('dist/index.js', 'export function foo(a) {'),
      line('dist/index.d.ts', 'export declare function foo(a: string): void;'),
    ]);
    expect(exports).toHaveLength(1);
    expect(exports[0].file).toBe('dist/index.d.ts');
  });

  it('prefers a real declaration over a re-export of the same name', () => {
    const exports = buildExportIndex([
      line('index.d.ts', "export { sendMagicCode } from './auth';"),
      line(
        'auth/deep/nested/impl.d.ts',
        'export declare function sendMagicCode(p: P): Promise<R>;',
      ),
    ]);
    expect(exports).toHaveLength(1);
    expect(exports[0].kind).toBe('function');
    expect(exports[0].signature).toContain('Promise<R>');
  });

  it('sorts by kind rank, then name', () => {
    const exports = buildExportIndex([
      line('i.d.ts', 'export type Zed = 1;'),
      line('i.d.ts', 'export declare const alpha: 1;'),
      line('i.d.ts', 'export declare function beta(): void;'),
      line('i.d.ts', 'export declare class Ada {'),
    ]);
    expect(exports.map((e) => e.name)).toEqual(['beta', 'Ada', 'Zed', 'alpha']);
  });

  it('caps the table at 300 symbols, keeping the best-scored ones', () => {
    const lines = [
      ...Array.from({ length: 350 }, (_, i) =>
        line('dist/deep/gen.js', `export function gen${i}() {`),
      ),
      line('index.d.ts', 'export declare function keeper(): void;'),
    ];
    const exports = buildExportIndex(lines);
    expect(exports).toHaveLength(300);
    expect(exports.some((e) => e.name === 'keeper')).toBe(true);
  });

  it('truncates very long signature lines', () => {
    const long = `export declare function huge(${'a: string, '.repeat(40)}): void;`;
    const exports = buildExportIndex([line('index.d.ts', long)]);
    expect(exports[0].signature.length).toBeLessThanOrEqual(161);
    expect(exports[0].signature.endsWith('…')).toBe(true);
  });
});
