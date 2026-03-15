import type { AnySpec } from './specs';

export interface ObligationRecord {
  readonly id: string;
  readonly specId: string;
  readonly kind: string;
  readonly clauseId: string;
  readonly description: string;
  readonly status?: 'PENDING' | 'PROVED' | 'REFUTED' | 'UNKNOWN' | 'TESTED';
}

export function generateObligations(
  spec: AnySpec
): readonly ObligationRecord[] {
  const obligations: ObligationRecord[] = [];

  switch (spec.kind) {
    case 'requirement':
      // metadata-only, no executable obligations
      // traceability obligations based on dependsOn
      for (const dep of spec.dependsOn) {
        obligations.push({
          id: `${spec.id}:dep:${dep}`,
          specId: spec.id,
          kind: 'dep',
          clauseId: dep,
          description: `Dependency "${dep}" must be valid`,
        });
      }
      break;

    case 'law':
      for (const l of spec.laws) {
        obligations.push({
          id: `${spec.id}:law:${l.id}`,
          specId: spec.id,
          kind: 'law',
          clauseId: l.id,
          description: l.description,
        });
      }
      // SMT soundness
      obligations.push({
        id: `${spec.id}:smt:consistency`,
        specId: spec.id,
        kind: 'smt',
        clauseId: 'consistency',
        description: 'Law clauses are mutually consistent',
      });
      break;

    case 'usecase':
      for (const g of spec.given) {
        obligations.push({
          id: `${spec.id}:given:${g.id}`,
          specId: spec.id,
          kind: 'given',
          clauseId: g.id,
          description: g.description,
        });
      }
      for (const e of spec.ensures) {
        obligations.push({
          id: `${spec.id}:ensure:${e.id}`,
          specId: spec.id,
          kind: 'ensure',
          clauseId: e.id,
          description: e.description,
        });
      }
      for (const inv of spec.invariants) {
        obligations.push({
          id: `${spec.id}:invariant:${inv.id}`,
          specId: spec.id,
          kind: 'invariant',
          clauseId: inv.id,
          description: inv.description,
        });
      }
      for (const e of spec.errors) {
        obligations.push({
          id: `${spec.id}:error:${e.id}`,
          specId: spec.id,
          kind: 'error',
          clauseId: e.id,
          description: e.description,
        });
      }
      for (const eff of spec.effects) {
        obligations.push({
          id: `${spec.id}:effect:${eff.id}:${eff.facet}`,
          specId: spec.id,
          kind: 'effect',
          clauseId: eff.id,
          description: eff.description,
        });
      }
      // runtime no-throw
      obligations.push({
        id: `${spec.id}:runtime:no_throw`,
        specId: spec.id,
        kind: 'runtime',
        clauseId: 'no_throw',
        description: 'Target function must not throw',
      });
      // SMT consistency
      obligations.push({
        id: `${spec.id}:smt:consistency`,
        specId: spec.id,
        kind: 'smt',
        clauseId: 'consistency',
        description: 'Spec clauses are mutually consistent',
      });
      // SMT error completeness
      obligations.push({
        id: `${spec.id}:smt:error_completeness`,
        specId: spec.id,
        kind: 'smt',
        clauseId: 'error_completeness',
        description: 'Error conditions are mutually exclusive',
      });
      // SMT refinement per dependency
      for (const dep of spec.dependsOn) {
        obligations.push({
          id: `${spec.id}:smt:refinement:${dep}`,
          specId: spec.id,
          kind: 'smt',
          clauseId: `refinement:${dep}`,
          description: `Refinement from "${dep}" is valid`,
        });
      }
      break;
  }

  return obligations;
}
