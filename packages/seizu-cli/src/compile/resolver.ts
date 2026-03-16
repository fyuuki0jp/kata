import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

  for (const { spec } of specs) {
    if (spec.kind === 'requirement') {
      // Requirements don't have targets
      continue;
    }

    const target = spec.target;
    if (!target) {
      continue;
    }

    // Resolve target.module relative to the project base path (cwd),
    // consistent with verify.ts which uses resolve(basePath, specObj.target.module)
    let resolvedPath = resolve(basePath, target.module);

    // Try common extensions if the file doesn't exist as-is
    if (!existsSync(resolvedPath)) {
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];
      for (const ext of extensions) {
        const candidate = resolvedPath + ext;
        if (existsSync(candidate)) {
          resolvedPath = candidate;
          break;
        }
      }
      // Also try index files
      if (!existsSync(resolvedPath)) {
        for (const ext of extensions) {
          const candidate = resolve(resolvedPath, `index${ext}`);
          if (existsSync(candidate)) {
            resolvedPath = candidate;
            break;
          }
        }
      }
    }

    targets.push({
      specId: spec.id,
      kind: spec.kind,
      modulePath: resolvedPath,
      exportName: target.export,
    });
  }

  return targets;
}
