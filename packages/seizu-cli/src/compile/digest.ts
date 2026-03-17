import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export function computeDigest(
  files: readonly string[],
  basePath: string
): string {
  const hash = createHash('sha256');
  const root = resolve(basePath);
  for (const file of [...files].sort()) {
    const absolutePath = resolve(root, file);
    const relPath = relative(root, absolutePath).replace(/\\/g, '/');
    hash.update(relPath);
    hash.update(readFileSync(absolutePath, 'utf-8'));
  }
  return hash.digest('hex');
}
