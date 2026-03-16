import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type { DiscoveredSpec } from './discovery';

export interface ResolvedTarget {
  readonly specId: string;
  readonly kind: string;
  readonly modulePath: string;
  readonly exportName: string;
}

export function resolveTargets(
  specs: readonly DiscoveredSpec[],
  basePath: string
): readonly ResolvedTarget[] {
  const targets: ResolvedTarget[] = [];

  for (const { spec, modulePath } of specs) {
    if (spec.kind === 'requirement') {
      // Requirements don't have targets
      continue;
    }

    const target = spec.target;
    if (!target) {
      continue;
    }

    const resolvedPath = resolveTargetModule(
      target.module,
      basePath,
      modulePath
    );

    targets.push({
      specId: spec.id,
      kind: spec.kind,
      modulePath: relative(basePath, resolvedPath),
      exportName: target.export,
    });
  }

  return targets;
}

function resolveTargetModule(
  moduleRef: string,
  basePath: string,
  specModulePath: string
): string {
  const candidates = new Set<string>();
  const specDir = dirname(specModulePath);

  // Resolve relative to project root first
  candidates.add(resolve(basePath, moduleRef));
  // Fallback: relative to spec file directory
  candidates.add(resolve(specDir, moduleRef));
  // Fallback: relative to package root one level above the spec file
  candidates.add(resolve(specDir, '..', moduleRef));
  // Fallback: two levels up (e.g., src/spec -> src)
  candidates.add(resolve(specDir, '..', '..', moduleRef));

  for (const candidate of candidates) {
    const resolved = resolveWithExtensions(candidate);
    if (resolved) return resolved;
  }

  // Nothing found, return best-effort project-root resolution
  return resolve(basePath, moduleRef);
}

function resolveWithExtensions(base: string): string | null {
  if (existsSync(base)) return base;

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];
  for (const ext of extensions) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }

  for (const ext of extensions) {
    const candidate = resolve(base, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}
