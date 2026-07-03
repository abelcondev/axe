/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  cleanVersion,
  parseDependencies,
  resolveDependencyVersion,
} from './dependencies.js';

describe('cleanVersion', () => {
  it('strips caret/tilde range operators', () => {
    expect(cleanVersion('^1.2.3')).toBe('1.2.3');
    expect(cleanVersion('~4.5.6')).toBe('4.5.6');
    expect(cleanVersion('>=2.0.0')).toBe('2.0.0');
  });

  it('drops a leading v prefix', () => {
    expect(cleanVersion('v1.0.0')).toBe('1.0.0');
    expect(cleanVersion('^v1.0.0')).toBe('1.0.0');
  });

  it('collapses open ranges and wildcards to latest', () => {
    expect(cleanVersion('*')).toBe('latest');
    expect(cleanVersion('x')).toBe('latest');
    expect(cleanVersion('1.x')).toBe('latest');
    expect(cleanVersion('')).toBe('latest');
    expect(cleanVersion('latest')).toBe('latest');
  });

  it('keeps the first comparator of a compound range', () => {
    expect(cleanVersion('>=1.0.0 <2.0.0')).toBe('1.0.0');
    expect(cleanVersion('1.2.3 || 2.0.0')).toBe('1.2.3');
  });
});

describe('resolveDependencyVersion', () => {
  it('resolves a plain caret range', () => {
    expect(resolveDependencyVersion('react', '^18.2.0')).toEqual({
      name: 'react',
      installName: 'react',
      version: '18.2.0',
      rawVersion: '^18.2.0',
    });
  });

  it('unwraps npm: aliases to the target package', () => {
    expect(resolveDependencyVersion('my-lodash', 'npm:lodash@^4.17.0')).toEqual({
      name: 'lodash',
      installName: 'my-lodash',
      version: '4.17.0',
      rawVersion: 'npm:lodash@^4.17.0',
    });
  });

  it('unwraps scoped npm: aliases', () => {
    const dep = resolveDependencyVersion('vue', 'npm:@vue/compat@3.2.0');
    expect(dep?.name).toBe('@vue/compat');
    expect(dep?.installName).toBe('vue');
    expect(dep?.version).toBe('3.2.0');
  });

  it('rejects non-registry protocols', () => {
    expect(resolveDependencyVersion('a', 'workspace:*')).toBeNull();
    expect(resolveDependencyVersion('a', 'file:../a')).toBeNull();
    expect(resolveDependencyVersion('a', 'link:../a')).toBeNull();
    expect(
      resolveDependencyVersion('a', 'git+https://github.com/x/y.git'),
    ).toBeNull();
    expect(
      resolveDependencyVersion('a', 'github:x/y'),
    ).toBeNull();
    expect(
      resolveDependencyVersion('a', 'https://example.com/a.tgz'),
    ).toBeNull();
  });
});

describe('parseDependencies', () => {
  it('includes dependencies and peerDependencies, excludes dev/optional', () => {
    const deps = parseDependencies({
      dependencies: { react: '^18.0.0' },
      peerDependencies: { 'react-dom': '^18.0.0' },
      devDependencies: { vitest: '^1.0.0' },
      optionalDependencies: { fsevents: '^2.0.0' },
    });
    const names = deps.map((d) => d.name).sort();
    expect(names).toEqual(['react', 'react-dom']);
  });

  it('drops non-registry specs', () => {
    const deps = parseDependencies({
      dependencies: {
        real: '^1.0.0',
        internal: 'workspace:*',
        pinned: 'file:../pinned',
      },
    });
    expect(deps.map((d) => d.name)).toEqual(['real']);
  });

  it('lets a dependency win over a duplicate peerDependency', () => {
    const deps = parseDependencies({
      dependencies: { react: '^18.2.0' },
      peerDependencies: { react: '^17.0.0' },
    });
    expect(deps).toHaveLength(1);
    expect(deps[0].version).toBe('18.2.0');
  });

  it('returns empty for a package.json without production deps', () => {
    expect(parseDependencies({ name: 'x', devDependencies: {} })).toEqual([]);
  });
});
