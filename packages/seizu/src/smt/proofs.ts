import { specRefId, specRefMode } from '../spec/clauses';
import type { RefinementGraph } from '../spec/graph';
import type { AnySpec, LawSpec, UsecaseSpec } from '../spec/specs';
import {
  buildPrelude,
  buildSmtLib,
  collectVariables,
  encodeExpr,
} from './encoder';
import { extractPredicateIR } from './extractor';
import type { SmtExpr, SmtResult } from './ir';
import type { SmtSolver } from './solver';

/**
 * Run all SMT proofs for a spec graph.
 * Returns SMT results for each obligation.
 *
 * @param predicateIRs - Optional map of clauseId -> SmtExpr from AST extraction.
 *   When provided, these are used instead of Function.toString() extraction.
 */
export async function proveGraph(
  graph: RefinementGraph,
  solver: SmtSolver,
  predicateIRs?: ReadonlyMap<string, SmtExpr>
): Promise<readonly SmtResult[]> {
  const results: SmtResult[] = [];
  const specs = graph.allSpecs();

  for (const spec of specs) {
    try {
      const specResults = await proveSpec(spec, graph, solver, predicateIRs);
      results.push(...specResults);
    } catch (e) {
      // If an entire spec's proof fails, record UNKNOWN for its consistency obligation
      results.push({
        obligationId: `${spec.id}:smt:consistency`,
        status: 'UNKNOWN' as const,
        reason: `SMT proof failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return results;
}

/**
 * Resolve predicate IR: try AST-extracted IR first, fall back to Function.toString().
 */
function resolvePredicateIR(
  clauseId: string,
  predicate: (...args: never) => unknown,
  predicateIRs?: ReadonlyMap<string, SmtExpr>
): SmtExpr {
  if (predicateIRs) {
    const astIR = predicateIRs.get(clauseId);
    if (astIR) return astIR;
  }
  return extractPredicateIR(predicate);
}

function collectVariableNames(exprs: readonly SmtExpr[]): ReadonlySet<string> {
  const names = new Set<string>();

  for (const expr of exprs) {
    for (const variable of collectVariables(expr)) {
      names.add(variable.name);
    }
  }

  return names;
}

function hasSharedVariables(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  for (const name of left) {
    if (right.has(name)) {
      return true;
    }
  }

  return false;
}

/**
 * Prove individual spec properties.
 */
async function proveSpec(
  spec: AnySpec,
  graph: RefinementGraph,
  solver: SmtSolver,
  predicateIRs?: ReadonlyMap<string, SmtExpr>
): Promise<SmtResult[]> {
  const results: SmtResult[] = [];

  switch (spec.kind) {
    case 'law':
      results.push(await proveLawSoundness(spec, solver, predicateIRs));
      break;

    case 'usecase':
      // 1. Spec consistency
      results.push(await proveSpecConsistency(spec, solver, predicateIRs));
      // 2. Error completeness (if there are multiple errors)
      if (spec.errors.length > 1) {
        results.push(await proveErrorCompleteness(spec, solver, predicateIRs));
      }
      // 3. Assume-Guarantee: for each dependency, prove refinement
      for (const depRef of spec.dependsOn) {
        if (specRefMode(depRef) !== 'axiom') continue;
        const depSpec = graph.get(specRefId(depRef));
        if (depSpec) {
          results.push(
            await proveRefinement(spec, depSpec, solver, predicateIRs)
          );
        }
      }
      break;

    case 'requirement':
      // No SMT proofs for requirements (metadata only)
      break;
  }

  return results;
}

/**
 * Prove law soundness: all law clauses are mutually consistent.
 * We check that the conjunction of all laws is satisfiable (not contradictory).
 */
async function proveLawSoundness(
  spec: LawSpec,
  solver: SmtSolver,
  predicateIRs?: ReadonlyMap<string, SmtExpr>
): Promise<SmtResult> {
  const obligationId = `${spec.id}:smt:consistency`;

  const lawExprs: SmtExpr[] = [];
  for (const clause of spec.laws) {
    const ir = resolvePredicateIR(clause.id, clause.predicate, predicateIRs);
    if (ir.kind === 'unsupported') {
      return {
        obligationId,
        status: 'UNKNOWN',
        reason: `Cannot parse law predicate "${clause.id}": ${ir.reason}`,
      };
    }
    lawExprs.push(ir);
  }

  if (lawExprs.length === 0) {
    return { obligationId, status: 'PROVED', reason: 'No laws to check' };
  }

  // Build conjunction of all laws
  const conjunction = lawExprs.reduce(
    (acc: SmtExpr, e: SmtExpr): SmtExpr => ({
      kind: 'binop',
      op: '&&',
      left: acc,
      right: e,
    })
  );

  // Collect all variables
  const allVars = collectVariables(conjunction);

  // To check consistency, we want to know if the conjunction is satisfiable.
  // We assert (not conjunction) — if unsat, the conjunction is a tautology (always true).
  // But for consistency, we just need satisfiability of the conjunction itself.
  // So we assert the conjunction and check sat.
  // sat = consistent, unsat = contradictory.
  //
  // However, our buildSmtLib negates the goal. So we pass the conjunction
  // and check: if (not conjunction) is unsat → conjunction is always true (proved).
  // If sat → there exists a case where it's false (which is fine for consistency).
  //
  // For soundness check, we want: conjunction is satisfiable.
  // We can directly build SMT-LIB with assertions (no negation).
  const lines = [...buildPrelude(allVars, lawExprs)];

  // Assert all laws
  for (const lawExpr of lawExprs) {
    try {
      lines.push(`(assert ${encodeExpr(lawExpr)})`);
    } catch (e) {
      return {
        obligationId,
        status: 'UNKNOWN' as const,
        reason: `Failed to encode law: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  lines.push('');
  lines.push('(check-sat)');

  const smtLib = lines.join('\n');
  const rawResult = await solver.solve(smtLib, obligationId);

  // For consistency check: sat means consistent (PROVED), unsat means contradictory (REFUTED)
  if (rawResult.status === 'PROVED') {
    // solver returned PROVED means check-sat was unsat → contradictory
    return {
      ...rawResult,
      obligationId,
      status: 'REFUTED',
      reason: 'Laws are contradictory',
    };
  } else if (rawResult.status === 'REFUTED') {
    // solver returned REFUTED means check-sat was sat → consistent
    return {
      ...rawResult,
      obligationId,
      status: 'PROVED',
      reason: 'Laws are consistent',
    };
  }
  return { ...rawResult, obligationId };
}

/**
 * Prove spec consistency: given conditions imply that ensures/invariants are satisfiable.
 * Check: given ∧ ensures ∧ invariants is satisfiable.
 */
async function proveSpecConsistency(
  spec: UsecaseSpec,
  solver: SmtSolver,
  predicateIRs?: ReadonlyMap<string, SmtExpr>
): Promise<SmtResult> {
  const obligationId = `${spec.id}:smt:consistency`;

  const allExprs: SmtExpr[] = [];
  const unsupportedClauses: string[] = [];

  for (const clause of spec.given) {
    const ir = resolvePredicateIR(clause.id, clause.predicate, predicateIRs);
    if (ir.kind === 'unsupported') {
      unsupportedClauses.push(`given "${clause.id}": ${ir.reason}`);
    } else {
      allExprs.push(ir);
    }
  }

  for (const clause of spec.ensures) {
    const ir = resolvePredicateIR(clause.id, clause.predicate, predicateIRs);
    if (ir.kind === 'unsupported') {
      unsupportedClauses.push(`ensure "${clause.id}": ${ir.reason}`);
    } else {
      allExprs.push(ir);
    }
  }

  for (const clause of spec.invariants) {
    const ir = resolvePredicateIR(clause.id, clause.predicate, predicateIRs);
    if (ir.kind === 'unsupported') {
      unsupportedClauses.push(`invariant "${clause.id}": ${ir.reason}`);
    } else {
      allExprs.push(ir);
    }
  }

  if (unsupportedClauses.length > 0) {
    return {
      obligationId,
      status: 'UNKNOWN',
      reason: `Cannot encode ${unsupportedClauses.length} clause(s): ${unsupportedClauses.join('; ')}`,
    };
  }

  if (allExprs.length === 0) {
    return { obligationId, status: 'PROVED', reason: 'No clauses to check' };
  }

  // Build conjunction
  const conjunction = allExprs.reduce(
    (acc: SmtExpr, e: SmtExpr): SmtExpr => ({
      kind: 'binop',
      op: '&&',
      left: acc,
      right: e,
    })
  );

  const allVars = collectVariables(conjunction);

  // Check satisfiability: assert conjunction, check-sat
  // sat = consistent (PROVED), unsat = inconsistent (REFUTED)
  const lines = [...buildPrelude(allVars, allExprs)];

  for (const expr of allExprs) {
    try {
      lines.push(`(assert ${encodeExpr(expr)})`);
    } catch (e) {
      return {
        obligationId,
        status: 'UNKNOWN' as const,
        reason: `Failed to encode clause: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  lines.push('');
  lines.push('(check-sat)');

  const smtLib = lines.join('\n');
  const rawResult = await solver.solve(smtLib, obligationId);

  // Flip: sat → consistent (PROVED), unsat → inconsistent (REFUTED)
  if (rawResult.status === 'PROVED') {
    return {
      ...rawResult,
      obligationId,
      status: 'REFUTED',
      reason:
        'Spec is inconsistent: given ∧ ensures ∧ invariants is unsatisfiable',
    };
  } else if (rawResult.status === 'REFUTED') {
    return {
      ...rawResult,
      obligationId,
      status: 'PROVED',
      reason: 'Spec is consistent',
    };
  }
  return { ...rawResult, obligationId };
}

/**
 * Prove error completeness: error predicates are mutually exclusive.
 * For each pair (i, j), check that error_i ∧ error_j is unsatisfiable.
 */
async function proveErrorCompleteness(
  spec: UsecaseSpec,
  solver: SmtSolver,
  predicateIRs?: ReadonlyMap<string, SmtExpr>
): Promise<SmtResult> {
  const obligationId = `${spec.id}:smt:error_completeness`;

  // All error clauses must have predicates to evaluate completeness
  const missingPredicates = spec.errors.filter((c) => !c.predicate);
  if (missingPredicates.length > 0) {
    return {
      obligationId,
      status: 'UNKNOWN',
      reason: `${missingPredicates.length} error clause(s) missing predicates: ${missingPredicates.map((c) => c.id).join(', ')}`,
    };
  }

  const errorExprs: { id: string; ir: SmtExpr }[] = [];
  for (const clause of spec.errors) {
    if (clause.predicate) {
      const ir = resolvePredicateIR(clause.id, clause.predicate, predicateIRs);
      if (ir.kind === 'unsupported') {
        return {
          obligationId,
          status: 'UNKNOWN',
          reason: `Cannot encode error predicate "${clause.id}": ${ir.reason}`,
        };
      }
      errorExprs.push({ id: clause.id, ir });
    }
  }

  if (errorExprs.length < 2) {
    return {
      obligationId,
      status: 'PROVED',
      reason: 'Fewer than 2 error predicates to check',
    };
  }

  // Check pairwise mutual exclusion
  for (let i = 0; i < errorExprs.length; i++) {
    for (let j = i + 1; j < errorExprs.length; j++) {
      const pair: SmtExpr = {
        kind: 'binop',
        op: '&&',
        left: errorExprs[i].ir,
        right: errorExprs[j].ir,
      };

      let vars: import('./ir').SmtVar[];
      try {
        vars = collectVariables(pair);
      } catch (e) {
        return {
          obligationId,
          status: 'UNKNOWN' as const,
          reason: `Failed to collect variables for "${errorExprs[i].id}" vs "${errorExprs[j].id}": ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      // For mutual exclusion we want (e_i ∧ e_j) to be unsat.
      // Direct approach: assert (e_i ∧ e_j) and check-sat.
      // sat → overlap exists (REFUTED), unsat → mutually exclusive (PROVED)
      const lines = [...buildPrelude(vars, [pair])];

      try {
        lines.push(`(assert ${encodeExpr(pair)})`);
      } catch (e) {
        return {
          obligationId,
          status: 'UNKNOWN' as const,
          reason: `Failed to encode error pair "${errorExprs[i].id}" vs "${errorExprs[j].id}": ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      lines.push('');
      lines.push('(check-sat)');

      const pairSmtLib = lines.join('\n');
      const pairResult = await solver.solve(
        pairSmtLib,
        `${obligationId}/${errorExprs[i].id}-vs-${errorExprs[j].id}`
      );

      if (pairResult.status === 'REFUTED') {
        // sat → overlap exists
        return {
          obligationId,
          status: 'REFUTED',
          encoding: pairSmtLib,
          reason: `Error predicates "${errorExprs[i].id}" and "${errorExprs[j].id}" can both be true simultaneously`,
          counterexample: pairResult.counterexample,
        };
      } else if (pairResult.status === 'UNKNOWN') {
        return { ...pairResult, obligationId };
      }
      // PROVED (unsat) → this pair is mutually exclusive, continue
    }
  }

  return {
    obligationId,
    status: 'PROVED',
    reason: 'All error predicates are mutually exclusive',
  };
}

/**
 * Prove refinement using Assume-Guarantee.
 *
 * ASSUME: depSpec.ensures/laws (axioms from the dependency)
 * PROVE: spec.ensures (goal)
 *
 * For each ensure clause in spec:
 *   (∧ dep_ensures) ∧ (∧ given) → ensure is valid
 *   ↔ (∧ dep_ensures) ∧ (∧ given) ∧ (¬ ensure) is unsat
 */
async function proveRefinement(
  spec: UsecaseSpec,
  depSpec: AnySpec,
  solver: SmtSolver,
  predicateIRs?: ReadonlyMap<string, SmtExpr>
): Promise<SmtResult> {
  const obligationId = `${spec.id}:smt:refinement:${depSpec.id}`;

  // Collect axioms from the dependency
  const axioms: SmtExpr[] = [];

  if (depSpec.kind === 'usecase') {
    for (const clause of depSpec.ensures) {
      const ir = resolvePredicateIR(clause.id, clause.predicate, predicateIRs);
      if (ir.kind === 'unsupported') {
        return {
          obligationId,
          status: 'UNKNOWN',
          reason: `Cannot encode dependency ensure "${clause.id}": ${ir.reason}`,
        };
      }
      axioms.push(ir);
    }
    for (const clause of depSpec.invariants) {
      const ir = resolvePredicateIR(clause.id, clause.predicate, predicateIRs);
      if (ir.kind === 'unsupported') {
        return {
          obligationId,
          status: 'UNKNOWN',
          reason: `Cannot encode dependency invariant "${clause.id}": ${ir.reason}`,
        };
      }
      axioms.push(ir);
    }
  } else if (depSpec.kind === 'law') {
    for (const clause of depSpec.laws) {
      const ir = resolvePredicateIR(clause.id, clause.predicate, predicateIRs);
      if (ir.kind === 'unsupported') {
        return {
          obligationId,
          status: 'UNKNOWN',
          reason: `Cannot encode dependency law "${clause.id}": ${ir.reason}`,
        };
      }
      axioms.push(ir);
    }
  }

  // Collect preconditions from the spec's given clauses
  const preconditions: SmtExpr[] = [];
  for (const clause of spec.given) {
    const ir = resolvePredicateIR(clause.id, clause.predicate, predicateIRs);
    if (ir.kind === 'unsupported') {
      return {
        obligationId,
        status: 'UNKNOWN',
        reason: `Cannot encode given "${clause.id}": ${ir.reason}`,
      };
    }
    preconditions.push(ir);
  }
  const axiomVariableNames = collectVariableNames(axioms);
  const preconditionVariableNames = collectVariableNames(preconditions);

  // Prove each ensure clause
  const ensureResults: SmtResult[] = [];
  for (const clause of spec.ensures) {
    const goal = resolvePredicateIR(clause.id, clause.predicate, predicateIRs);
    if (goal.kind === 'unsupported') {
      ensureResults.push({
        obligationId: `${obligationId}/${clause.id}`,
        status: 'UNKNOWN',
        reason: `Cannot parse ensure predicate: ${goal.reason}`,
      });
      continue;
    }

    const goalVariableNames = collectVariableNames([goal]);
    const localContextVariableNames = new Set<string>([
      ...preconditionVariableNames,
      ...goalVariableNames,
    ]);
    if (
      axiomVariableNames.size > 0 &&
      !hasSharedVariables(axiomVariableNames, localContextVariableNames)
    ) {
      ensureResults.push({
        obligationId: `${obligationId}/${clause.id}`,
        status: 'UNKNOWN' as const,
        reason:
          'Refinement is under-specified: dependency axioms and target clauses do not share symbolic state',
      });
      continue;
    }

    // Collect all variables across axioms, preconditions, and goal
    const allExprs = [...axioms, ...preconditions, goal];
    const allVars = new Map<string, import('./ir').SmtVar>();
    for (const e of allExprs) {
      for (const v of collectVariables(e)) {
        allVars.set(v.name, v);
      }
    }

    let smtLib: string;
    try {
      smtLib = buildSmtLib([...allVars.values()], axioms, preconditions, goal);
    } catch (e) {
      ensureResults.push({
        obligationId: `${obligationId}/${clause.id}`,
        status: 'UNKNOWN' as const,
        reason: `SMT encoding failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }
    const result = await solver.solve(smtLib, `${obligationId}/${clause.id}`);
    ensureResults.push(result);
  }

  // Aggregate results
  const refuted = ensureResults.find((r) => r.status === 'REFUTED');
  if (refuted) {
    return { ...refuted, obligationId };
  }

  const unknown = ensureResults.find((r) => r.status === 'UNKNOWN');
  if (unknown) {
    return { ...unknown, obligationId };
  }

  if (ensureResults.length === 0) {
    return { obligationId, status: 'PROVED', reason: 'No ensures to prove' };
  }

  return {
    obligationId,
    status: 'PROVED',
    reason: `All ${ensureResults.length} ensure clause(s) proved`,
  };
}
