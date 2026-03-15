import type { ObligationStatus } from './base';
import type { RefinementGraph } from './graph';

export type PropagationStatus =
  | 'valid'
  | 'invalid'
  | 'assumed'
  | 'unknown'
  | 'refuted';

export interface ObligationResult {
  readonly obligationId: string;
  readonly status: ObligationStatus;
}

export interface SpecVerifyResult {
  readonly specId: string;
  readonly obligations: readonly ObligationResult[];
}

export interface PropagatedEvidence {
  readonly specId: string;
  readonly status: PropagationStatus;
  readonly invalidDeps: readonly string[];
}

export function propagateEvidence(
  graph: RefinementGraph,
  results: ReadonlyMap<string, SpecVerifyResult>
): ReadonlyMap<string, PropagatedEvidence> {
  const sorted = graph.topologicalSort();
  const evidence = new Map<string, PropagatedEvidence>();

  // Process in reverse topological order (leaves first)
  for (const specId of [...sorted].reverse()) {
    const result = results.get(specId);
    const deps = graph.dependencies(specId);

    // Determine own status from obligations
    let ownStatus: PropagationStatus = 'valid';
    if (result) {
      const statuses = result.obligations.map((o) => o.status);
      if (statuses.some((s) => s === 'REFUTED')) {
        ownStatus = 'refuted';
      } else if (statuses.some((s) => s === 'UNKNOWN')) {
        ownStatus = 'unknown';
      } else if (statuses.some((s) => s === 'ASSUMED')) {
        ownStatus = 'assumed';
      }
      // else all PROVED/TESTED → valid
    } else {
      ownStatus = 'unknown'; // no results yet
    }

    // Check dependencies
    const invalidDeps: string[] = [];
    for (const dep of deps) {
      const depEvidence = evidence.get(dep);
      if (
        !depEvidence ||
        depEvidence.status === 'refuted' ||
        depEvidence.status === 'invalid' ||
        depEvidence.status === 'unknown'
      ) {
        invalidDeps.push(dep);
      }
    }

    // Apply priority: REFUTED > UNKNOWN > invalid deps > ASSUMED > valid
    let finalStatus: PropagationStatus;
    if (ownStatus === 'refuted') {
      finalStatus = 'refuted';
    } else if (ownStatus === 'unknown') {
      finalStatus = 'unknown';
    } else if (invalidDeps.length > 0) {
      finalStatus = 'invalid';
    } else if (ownStatus === 'assumed') {
      finalStatus = 'assumed';
    } else {
      finalStatus = 'valid';
    }

    evidence.set(specId, { specId, status: finalStatus, invalidDeps });
  }

  return evidence;
}
