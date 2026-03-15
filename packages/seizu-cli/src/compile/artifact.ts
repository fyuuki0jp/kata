import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SmtResult } from 'seizu/smt';
import type { AnySpec, ObligationRecord } from 'seizu/spec';
import type { ResolvedTarget } from './resolver';

export interface Diagnostic {
  readonly level: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly specId?: string;
}

export interface SerializedSpec {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly dependsOn: readonly string[];
}

export interface GraphArtifact {
  readonly artifactVersion: '3.0';
  readonly artifactDigest: string;
  readonly specs: readonly SerializedSpec[];
  readonly obligations: readonly ObligationRecord[];
  readonly edges: readonly { from: string; to: string }[];
  readonly smtResults: readonly SmtResult[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface ManifestSpecEntry {
  readonly specId: string;
  readonly kind: string;
  readonly modulePath: string;
  readonly exportName: string;
  readonly index: number;
  readonly specHash: string;
}

export interface ManifestArtifact {
  readonly artifactVersion: '3.0';
  readonly artifactDigest: string;
  readonly entrypoints: readonly { path: string; digest: string }[];
  readonly targets: readonly ResolvedTarget[];
  readonly specs: readonly ManifestSpecEntry[];
}

export function serializeSpec(spec: AnySpec): SerializedSpec {
  return {
    id: spec.id,
    kind: spec.kind,
    name: spec.name,
    dependsOn: spec.dependsOn.map((dep) =>
      typeof dep === 'string' ? dep : dep
    ),
  };
}

export function writeArtifacts(
  artifactDir: string,
  graph: GraphArtifact,
  manifest: ManifestArtifact
): void {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, 'graph.json'),
    JSON.stringify(graph, null, 2),
    'utf-8'
  );
  writeFileSync(
    join(artifactDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );
}
