import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AnySpec } from 'seizu/spec';

export interface DiscoveredSpec {
  readonly spec: AnySpec;
  readonly modulePath: string;
  readonly index: number;
}

/**
 * Resolve simple glob patterns (e.g. "src/spec/*.spec.ts") to absolute file paths.
 * Only supports single-level `*` wildcards in the filename portion — no `**` recursion.
 */
function resolveGlobPatterns(
  patterns: readonly string[],
  basePath: string
): string[] {
  const files: string[] = [];
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      // Simple glob: split into dir + filename pattern
      const dir = resolve(
        basePath,
        pattern.substring(0, pattern.lastIndexOf('/'))
      );
      const filePattern = pattern.substring(pattern.lastIndexOf('/') + 1);
      const regex = new RegExp(
        '^' + filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
      );
      try {
        for (const entry of readdirSync(dir)) {
          if (regex.test(entry)) {
            files.push(resolve(dir, entry));
          }
        }
      } catch {
        /* dir doesn't exist */
      }
    } else {
      files.push(resolve(basePath, pattern));
    }
  }
  return [...new Set(files)]; // dedup
}

export async function discoverSpecs(
  entrypoints: readonly string[],
  basePath: string
): Promise<readonly DiscoveredSpec[]> {
  const discovered: DiscoveredSpec[] = [];

  // 1. Resolve glob patterns to file paths
  const filePaths = resolveGlobPatterns(entrypoints, basePath);

  // 2. For each file, dynamically import and read .specs export
  for (const filePath of filePaths) {
    const fileUrl = pathToFileURL(filePath).href;
    const mod = (await import(fileUrl)) as Record<string, unknown>;

    const specs = mod.specs;
    if (!Array.isArray(specs)) {
      continue;
    }

    // 3. Validate and collect specs
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i] as AnySpec;
      if (
        !spec ||
        typeof spec !== 'object' ||
        !('kind' in spec) ||
        !('id' in spec)
      ) {
        continue;
      }
      discovered.push({
        spec,
        modulePath: filePath,
        index: i,
      });
    }
  }

  return discovered;
}
