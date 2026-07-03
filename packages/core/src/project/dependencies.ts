/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A single production dependency resolved from a `package.json`, ready to be
 * indexed by the reference service.
 */
export interface Dependency {
  /**
   * The registry package name to fetch source for. For `npm:` aliases this is
   * the *target* package (e.g. `dependencies: { foo: "npm:bar@^1" }` yields
   * `name: "bar"`).
   */
  name: string;
  /**
   * The name the package is installed under in `node_modules` — the dependency
   * key. Equal to {@link name} except for `npm:` aliases.
   */
  installName: string;
  /** Cleaned, concrete-ish version (range operators stripped) or `latest`. */
  version: string;
  /** The original version spec, verbatim. */
  rawVersion: string;
}

/**
 * Version specs that point at something other than a published registry
 * version. We can't index these against a known upstream, so they're excluded.
 */
const NON_REGISTRY_SPEC =
  /^(workspace:|file:|link:|portal:|git\+|git:|github:|https?:|bitbucket:|gitlab:)/;

/**
 * Normalizes a semver-ish version spec to a concrete version string usable as
 * a git tag / `npm pack` target. Range operators (`^`, `~`, `>=`, …) are
 * stripped; open ranges, `x`-ranges, and `*` collapse to `latest`.
 */
export function cleanVersion(spec: string): string {
  let v = spec.trim();
  if (v === '' || v === '*' || v === 'x' || v === 'X' || v === 'latest') {
    return 'latest';
  }
  // Compound ranges (">=1.0.0 <2.0.0", "1 || 2") — keep the first comparator.
  v = v.split(/\s+|\|\|/)[0].trim();
  // Strip leading range operators and a `v` prefix.
  v = v.replace(/^[\s^~>=<]*v?/, '');
  if (v === '' || /[x*]/i.test(v)) {
    return 'latest';
  }
  return v;
}

/**
 * Resolves a dependency entry (`name` → `spec`) to a {@link Dependency},
 * unwrapping `npm:` aliases. Returns `null` for specs that don't map to a
 * published registry version (workspace/file/git/url protocols).
 */
export function resolveDependencyVersion(
  name: string,
  spec: string,
): Dependency | null {
  let registryName = name;
  let versionSpec = spec.trim();

  if (versionSpec.startsWith('npm:')) {
    const rest = versionSpec.slice(4);
    // Scoped names keep a leading `@`, so find the version separator after it.
    const at = rest.lastIndexOf('@');
    if (at > 0) {
      registryName = rest.slice(0, at);
      versionSpec = rest.slice(at + 1);
    } else {
      registryName = rest;
      versionSpec = 'latest';
    }
  }

  if (NON_REGISTRY_SPEC.test(versionSpec)) {
    return null;
  }

  return {
    name: registryName,
    installName: name,
    version: cleanVersion(versionSpec),
    rawVersion: spec,
  };
}

/**
 * Extracts the production dependencies of a parsed `package.json`. Both
 * `dependencies` and `peerDependencies` are considered (a peer dep is real API
 * surface the code calls into); `devDependencies` and `optionalDependencies`
 * are excluded. Non-registry specs are dropped. The result is de-duplicated by
 * install name (a `dependencies` entry wins over a `peerDependencies` one).
 */
export function parseDependencies(
  pkgJson: Record<string, unknown>,
): Dependency[] {
  const byInstallName = new Map<string, Dependency>();

  const collect = (field: string) => {
    const block = pkgJson[field];
    if (!block || typeof block !== 'object') {
      return;
    }
    for (const [name, spec] of Object.entries(
      block as Record<string, unknown>,
    )) {
      if (typeof spec !== 'string') {
        continue;
      }
      const dep = resolveDependencyVersion(name, spec);
      if (dep && !byInstallName.has(dep.installName)) {
        byInstallName.set(dep.installName, dep);
      }
    }
  };

  // `dependencies` first so it wins over a duplicate `peerDependencies` entry.
  collect('dependencies');
  collect('peerDependencies');

  return [...byInstallName.values()];
}
