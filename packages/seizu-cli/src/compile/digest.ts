import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function computeDigest(files: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(file);
    hash.update(readFileSync(file, 'utf-8'));
  }
  return hash.digest('hex');
}
