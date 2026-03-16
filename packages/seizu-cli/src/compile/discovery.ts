import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AnySpec } from 'seizu/spec';
import { resolveGlobs } from '../doc/parser/source-resolver';

export interface DiscoveredSpec {
  readonly spec: AnySpec;
  readonly modulePath: string;
  readonly index: number;
}

export async function discoverSpecs(
  entrypoints: readonly string[],
  basePath: string
): Promise<readonly DiscoveredSpec[]> {
  const discovered: DiscoveredSpec[] = [];

  // 1. Resolve glob patterns to file paths
  const filePaths = resolveGlobs(entrypoints, basePath).map((p) => resolve(p));

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
