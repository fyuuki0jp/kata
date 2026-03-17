import * as fc from 'fast-check';
import { err, ok, type Result } from '../result';
import { lawSpec, requirementSpec, usecaseSpec } from './builders';
import { ensure, errorClause, given, invariant, law } from './clauses';
import { RefinementGraph } from './graph';
import { generateObligations } from './obligations';
import type { SpecVerifyResult } from './propagation';
import { propagateEvidence } from './propagation';
import type { AnySpec, LawSpec, RequirementSpec, UsecaseSpec } from './specs';

// ---------------------------------------------------------------------------
// Target helper functions
// These thin wrappers exist so that verifyLaw can resolve a plain function
// for the `target` field. The actual assertions live in law predicates.
// ---------------------------------------------------------------------------

/** Build a RefinementGraph from an array of specs and return its topological sort. */
export function buildAndSort(...args: unknown[]): readonly string[] {
  const specs = Array.isArray(args[0]) ? (args[0] as AnySpec[]) : [];
  if (specs.length === 0) return [];
  const g = new RefinementGraph();
  g.addAll(specs);
  return g.topologicalSort();
}

/** Wrap propagateEvidence for target resolution. */
export function propagateEvidenceTarget(
  ...args: unknown[]
): ReadonlyMap<string, unknown> {
  const specs = Array.isArray(args[0]) ? (args[0] as AnySpec[]) : [];
  const results =
    args[1] instanceof Map
      ? (args[1] as ReadonlyMap<string, SpecVerifyResult>)
      : new Map();
  if (specs.length === 0) return new Map();
  const g = new RefinementGraph();
  g.addAll(specs);
  return propagateEvidence(g, results);
}

/** Re-export generateObligations for target resolution. */
export { generateObligations } from './obligations';

// ---------------------------------------------------------------------------
// LawSpec: RefinementGraph Properties
// ---------------------------------------------------------------------------

export const graphTopologicalSortLaw: LawSpec = lawSpec({
  id: 'LAW-GraphTopologicalSort',
  name: 'Topological sort respects dependencies',
  target: { module: 'src/spec/seizu.spec', export: 'buildAndSort' },
  generators: {
    specs: fc.constant([
      {
        kind: 'law' as const,
        id: 'C',
        name: 'C',
        target: { module: '.', export: 'x' },
        generators: {},
        laws: [],
        dependsOn: [],
      },
      {
        kind: 'law' as const,
        id: 'B',
        name: 'B',
        target: { module: '.', export: 'x' },
        generators: {},
        laws: [],
        dependsOn: ['C'],
      },
      {
        kind: 'law' as const,
        id: 'A',
        name: 'A',
        target: { module: '.', export: 'x' },
        generators: {},
        laws: [],
        dependsOn: ['B'],
      },
    ]),
  },
  laws: [
    law(
      'topo-order',
      'Dependencies appear before dependants in topological order',
      (args: Record<string, unknown>, _result: unknown) => {
        const graph = new RefinementGraph();
        graph.addAll(args.specs as AnySpec[]);
        const sorted = graph.topologicalSort();
        const indexA = sorted.indexOf('A');
        const indexB = sorted.indexOf('B');
        const indexC = sorted.indexOf('C');
        return indexA < indexB && indexB < indexC;
      }
    ),
  ],
  dependsOn: [],
});

export const graphCycleDetectionLaw: LawSpec = lawSpec({
  id: 'LAW-GraphCycleDetection',
  name: 'Cycle detection catches circular dependencies',
  target: { module: 'src/spec/seizu.spec', export: 'buildAndSort' },
  generators: {
    _unused: fc.constant(null),
  },
  laws: [
    law(
      'cycle-throws',
      'topologicalSort throws CycleError for cyclic graphs',
      (_args: Record<string, unknown>, _result: unknown) => {
        const graph = new RefinementGraph();
        graph.addAll([
          {
            kind: 'law' as const,
            id: 'X',
            name: 'X',
            target: { module: '.', export: 'x' },
            generators: {},
            laws: [],
            dependsOn: ['Y'],
          },
          {
            kind: 'law' as const,
            id: 'Y',
            name: 'Y',
            target: { module: '.', export: 'x' },
            generators: {},
            laws: [],
            dependsOn: ['X'],
          },
        ] as AnySpec[]);
        try {
          graph.topologicalSort();
          return false; // should have thrown
        } catch {
          return true;
        }
      }
    ),
    law(
      'validate-catches-cycle',
      'validate() reports cycle as error',
      (_args: Record<string, unknown>, _result: unknown) => {
        const graph = new RefinementGraph();
        graph.addAll([
          {
            kind: 'law' as const,
            id: 'X',
            name: 'X',
            target: { module: '.', export: 'x' },
            generators: {},
            laws: [],
            dependsOn: ['Y'],
          },
          {
            kind: 'law' as const,
            id: 'Y',
            name: 'Y',
            target: { module: '.', export: 'x' },
            generators: {},
            laws: [],
            dependsOn: ['X'],
          },
        ] as AnySpec[]);
        const result = graph.validate();
        return !result.ok;
      }
    ),
    law(
      'validate-catches-unresolved',
      'validate() reports unresolved dependencies',
      (_args: Record<string, unknown>, _result: unknown) => {
        const graph = new RefinementGraph();
        graph.add({
          kind: 'law' as const,
          id: 'A',
          name: 'A',
          target: { module: '.', export: 'x' },
          generators: {},
          laws: [],
          dependsOn: ['MISSING'],
        } as AnySpec);
        const result = graph.validate();
        return !result.ok;
      }
    ),
  ],
  dependsOn: [],
});

export const graphDependencySymmetryLaw: LawSpec = lawSpec({
  id: 'LAW-GraphDependencySymmetry',
  name: 'dependencies() and dependants() are symmetric',
  target: { module: 'src/spec/seizu.spec', export: 'buildAndSort' },
  generators: {
    _unused: fc.constant(null),
  },
  laws: [
    law(
      'symmetry',
      'If A depends on B, then B has A as dependant',
      (_args: Record<string, unknown>, _result: unknown) => {
        const graph = new RefinementGraph();
        graph.addAll([
          {
            kind: 'law' as const,
            id: 'P',
            name: 'P',
            target: { module: '.', export: 'x' },
            generators: {},
            laws: [],
            dependsOn: ['Q'],
          },
          {
            kind: 'law' as const,
            id: 'Q',
            name: 'Q',
            target: { module: '.', export: 'x' },
            generators: {},
            laws: [],
            dependsOn: [],
          },
        ] as AnySpec[]);
        const pDeps = graph.dependencies('P');
        const qDependants = graph.dependants('Q');
        return pDeps.includes('Q') && qDependants.includes('P');
      }
    ),
  ],
  dependsOn: [],
});

// ---------------------------------------------------------------------------
// LawSpec: Evidence Propagation Properties
// ---------------------------------------------------------------------------

export const propagationPriorityLaw: LawSpec = lawSpec({
  id: 'LAW-PropagationPriority',
  name: 'Evidence propagation respects priority ordering',
  target: { module: 'src/spec/seizu.spec', export: 'propagateEvidenceTarget' },
  generators: {
    status: fc.constantFrom(
      'PROVED',
      'TESTED',
      'REFUTED',
      'UNKNOWN',
      'ASSUMED'
    ),
  },
  laws: [
    law(
      'refuted-highest',
      'REFUTED always propagates as refuted regardless of other statuses',
      (args: Record<string, unknown>, _result: unknown) => {
        const graph = new RefinementGraph();
        graph.add({
          kind: 'law' as const,
          id: 'LEAF',
          name: 'leaf',
          target: { module: '.', export: 'x' },
          generators: {},
          laws: [],
          dependsOn: [],
        } as AnySpec);

        const results = new Map<string, SpecVerifyResult>();
        results.set('LEAF', {
          specId: 'LEAF',
          obligations: [
            { obligationId: 'LEAF:law:test', status: 'REFUTED' },
            {
              obligationId: 'LEAF:smt:consistency',
              status: args.status as string,
            },
          ],
        });

        const evidence = propagateEvidence(graph, results);
        return evidence.get('LEAF')?.status === 'refuted';
      }
    ),
    law(
      'valid-only-when-all-proved-or-tested',
      'Valid requires all obligations to be PROVED or TESTED',
      (_args: Record<string, unknown>, _result: unknown) => {
        const graph = new RefinementGraph();
        graph.add({
          kind: 'law' as const,
          id: 'X',
          name: 'x',
          target: { module: '.', export: 'x' },
          generators: {},
          laws: [],
          dependsOn: [],
        } as AnySpec);

        const results = new Map<string, SpecVerifyResult>();
        results.set('X', {
          specId: 'X',
          obligations: [
            { obligationId: 'X:law:a', status: 'PROVED' },
            { obligationId: 'X:law:b', status: 'TESTED' },
          ],
        });

        const evidence = propagateEvidence(graph, results);
        return evidence.get('X')?.status === 'valid';
      }
    ),
  ],
  dependsOn: [],
});

export const propagationDepInvalidLaw: LawSpec = lawSpec({
  id: 'LAW-PropagationDepInvalid',
  name: 'REFUTED dependency propagates as invalid to parent',
  target: { module: 'src/spec/seizu.spec', export: 'propagateEvidenceTarget' },
  generators: {
    _unused: fc.constant(null),
  },
  laws: [
    law(
      'dep-refuted-invalidates-parent',
      'Parent becomes invalid when dependency is refuted',
      (_args: Record<string, unknown>, _result: unknown) => {
        const graph = new RefinementGraph();
        graph.addAll([
          {
            kind: 'law' as const,
            id: 'PARENT',
            name: 'parent',
            target: { module: '.', export: 'x' },
            generators: {},
            laws: [],
            dependsOn: ['CHILD'],
          },
          {
            kind: 'law' as const,
            id: 'CHILD',
            name: 'child',
            target: { module: '.', export: 'x' },
            generators: {},
            laws: [],
            dependsOn: [],
          },
        ] as AnySpec[]);

        const results = new Map<string, SpecVerifyResult>();
        results.set('PARENT', {
          specId: 'PARENT',
          obligations: [{ obligationId: 'PARENT:law:a', status: 'PROVED' }],
        });
        results.set('CHILD', {
          specId: 'CHILD',
          obligations: [{ obligationId: 'CHILD:law:a', status: 'REFUTED' }],
        });

        const evidence = propagateEvidence(graph, results);
        const childStatus = evidence.get('CHILD')?.status;
        const parentStatus = evidence.get('PARENT')?.status;
        const parentInvalidDeps = evidence.get('PARENT')?.invalidDeps ?? [];
        return (
          childStatus === 'refuted' &&
          parentStatus === 'invalid' &&
          parentInvalidDeps.includes('CHILD')
        );
      }
    ),
  ],
  dependsOn: ['LAW-PropagationPriority'],
});

// ---------------------------------------------------------------------------
// LawSpec: Obligation Generation Properties
// ---------------------------------------------------------------------------

export const obligationIdFormatLaw: LawSpec = lawSpec({
  id: 'LAW-ObligationIdFormat',
  name: 'Obligation IDs follow the fixed format',
  target: { module: 'src/spec/obligations', export: 'generateObligations' },
  generators: {
    specId: fc.constantFrom('UC-Test', 'LAW-Test', 'REQ-Test'),
  },
  laws: [
    law(
      'id-contains-spec-id',
      'Every obligation ID starts with the spec ID',
      (args: Record<string, unknown>, _result: unknown) => {
        const specId = args.specId as string;
        const spec = lawSpec({
          id: specId,
          name: 'test',
          target: { module: '.', export: 'x' },
          generators: {},
          laws: [
            { id: 'test-law', description: 'test', predicate: () => true },
          ],
          dependsOn: [],
        });

        const obligations = generateObligations(spec);
        return obligations.every((o) => o.id.startsWith(specId));
      }
    ),
    law(
      'id-format-colon-separated',
      'Obligation IDs use colon-separated format',
      (args: Record<string, unknown>, _result: unknown) => {
        const specId = args.specId as string;
        const spec = lawSpec({
          id: specId,
          name: 'test',
          target: { module: '.', export: 'x' },
          generators: {},
          laws: [{ id: 'my-law', description: 'test', predicate: () => true }],
          dependsOn: [],
        });

        const obligations = generateObligations(spec);
        return obligations.every((o) => o.id.split(':').length >= 3);
      }
    ),
  ],
  dependsOn: [],
});

export const obligationCountLaw: LawSpec = lawSpec({
  id: 'LAW-ObligationCount',
  name: 'Law specs generate correct number of obligations',
  target: { module: 'src/spec/obligations', export: 'generateObligations' },
  generators: {
    numLaws: fc.integer({ min: 1, max: 5 }),
  },
  laws: [
    law(
      'law-spec-obligation-count',
      'Law spec generates N law obligations + 1 SMT consistency obligation',
      (args: Record<string, unknown>, _result: unknown) => {
        const n = args.numLaws as number;
        const laws = Array.from({ length: n }, (_, i) => ({
          id: `law-${i}`,
          description: `test law ${i}`,
          predicate: () => true,
        }));
        const spec = lawSpec({
          id: 'LAW-CountTest',
          name: 'count test',
          target: { module: '.', export: 'x' },
          generators: {},
          laws,
          dependsOn: [],
        });

        const obligations = generateObligations(spec);
        // N law obligations + 1 SMT consistency = N + 1
        return obligations.length === n + 1;
      }
    ),
  ],
  dependsOn: [],
});

// ---------------------------------------------------------------------------
// UsecaseSpec: Graph Validation (async wrapper around RefinementGraph.validate)
// ---------------------------------------------------------------------------

// Target function: validates a spec graph (async to match UsecaseSpec contract)
type ValidateInput = { specs: AnySpec[] };
type ValidateOutput = {
  valid: boolean;
  specCount: number;
  obligationCount: number;
};
type ValidateError =
  | { type: 'cycle_detected' }
  | { type: 'unresolved_ref'; ref: string };
type ValidateState = { graphSize: number };

export async function validateSpecGraph(
  _deps: Record<string, never>,
  input: ValidateInput
): Promise<Result<ValidateOutput, ValidateError>> {
  const graph = new RefinementGraph();
  try {
    graph.addAll(input.specs);
  } catch {
    return err({ type: 'cycle_detected' as const });
  }
  const result = graph.validate();
  if (!result.ok) {
    const issues = result.error.issues;
    if (issues.some((i) => i.includes('Cycle'))) {
      return err({ type: 'cycle_detected' as const });
    }
    const unresolvedMatch = issues.find((i) => i.includes('does not exist'));
    if (unresolvedMatch) {
      const ref = unresolvedMatch.match(/"([^"]+)" which/)?.[1] ?? 'unknown';
      return err({ type: 'unresolved_ref' as const, ref });
    }
    return err({ type: 'cycle_detected' as const });
  }
  const allObligations = input.specs.flatMap((s) => generateObligations(s));
  return ok({
    valid: true,
    specCount: input.specs.length,
    obligationCount: allObligations.length,
  });
}

// InputArbitrary for UC-GraphValidation PBT
function makeLawSpec(id: string): AnySpec {
  return {
    kind: 'law' as const,
    id,
    name: id,
    target: { module: '.', export: 'x' },
    generators: {},
    laws: [{ id: 'l', description: 't', predicate: () => true }],
    dependsOn: [],
  };
}

export const inputArbitrary = fc.oneof(
  // Valid acyclic graph
  fc.constant({ specs: [makeLawSpec('A'), makeLawSpec('B')] } as ValidateInput),
  // Single spec
  fc.constant({ specs: [makeLawSpec('X')] } as ValidateInput),
  // Multiple specs with deps (valid)
  fc.constant({
    specs: [
      {
        kind: 'law' as const,
        id: 'P',
        name: 'P',
        target: { module: '.', export: 'x' },
        generators: {},
        laws: [{ id: 'l', description: 't', predicate: () => true }],
        dependsOn: ['Q'],
      },
      makeLawSpec('Q'),
    ],
  } as ValidateInput),
  // Error case: cyclic dependency → should return err({ type: 'cycle_detected' })
  fc.constant({
    specs: [
      {
        kind: 'law' as const,
        id: 'CYC-A',
        name: 'A',
        target: { module: '.', export: 'x' },
        generators: {},
        laws: [{ id: 'l', description: 't', predicate: () => true }],
        dependsOn: ['CYC-B'],
      },
      {
        kind: 'law' as const,
        id: 'CYC-B',
        name: 'B',
        target: { module: '.', export: 'x' },
        generators: {},
        laws: [{ id: 'l', description: 't', predicate: () => true }],
        dependsOn: ['CYC-A'],
      },
    ],
  } as ValidateInput),
  // Error case: unresolved dependency → should return err({ type: 'unresolved_ref' })
  fc.constant({
    specs: [
      {
        kind: 'law' as const,
        id: 'UNRES',
        name: 'U',
        target: { module: '.', export: 'x' },
        generators: {},
        laws: [{ id: 'l', description: 't', predicate: () => true }],
        dependsOn: ['MISSING'],
      },
    ],
  } as ValidateInput)
);

// Also export under the convention name
export { inputArbitrary as 'UC-GraphValidation_inputArbitrary' };

export const graphValidationUsecase: UsecaseSpec = usecaseSpec({
  id: 'UC-GraphValidation',
  name: 'Spec graph validation and obligation generation',
  target: { module: 'src/spec/seizu.spec', export: 'validateSpecGraph' },
  classifyError: (error: ValidateError) => error.type,
  given: [
    given(
      'non-empty',
      'Input specs array is non-empty',
      ({ input }: { input: ValidateInput }) => input.specs.length > 0
    ),
    given(
      'has-ids',
      'All specs have non-empty ids',
      ({ input }: { input: ValidateInput }) =>
        input.specs.every((s) => s.id.length > 0)
    ),
  ],
  ensures: [
    ensure(
      'spec-count-matches',
      'Output specCount matches input length',
      ({
        input,
        result,
      }: {
        before: ValidateState;
        after: ValidateState;
        input: ValidateInput;
        result: Result<ValidateOutput, ValidateError>;
      }) => (result.ok ? result.value.specCount === input.specs.length : true)
    ),
    ensure(
      'obligations-positive',
      'Valid graphs produce at least one obligation per spec',
      ({
        input,
        result,
      }: {
        before: ValidateState;
        after: ValidateState;
        input: ValidateInput;
        result: Result<ValidateOutput, ValidateError>;
      }) =>
        result.ok ? result.value.obligationCount >= input.specs.length : true
    ),
  ],
  invariants: [
    invariant(
      'output-consistent',
      'Valid flag is true on success',
      ({
        result,
      }: {
        before: ValidateState;
        after: ValidateState;
        input: ValidateInput;
        result: Result<ValidateOutput, ValidateError>;
      }) => (result.ok ? result.value.valid === true : true)
    ),
  ],
  errors: [
    errorClause(
      'err-cycle',
      'cycle_detected',
      'Cyclic dependencies detected',
      ({
        error,
      }: {
        input: ValidateInput;
        error: ValidateError;
        state: ValidateState;
      }) => error.type === 'cycle_detected'
    ),
    errorClause(
      'err-unresolved',
      'unresolved_ref',
      'Unresolved dependency reference',
      ({
        error,
      }: {
        input: ValidateInput;
        error: ValidateError;
        state: ValidateState;
      }) => error.type === 'unresolved_ref'
    ),
  ],
  effects: [],
  dependsOn: [
    { id: 'LAW-GraphTopologicalSort', mode: 'trace' },
    { id: 'LAW-GraphCycleDetection', mode: 'trace' },
    { id: 'LAW-ObligationIdFormat', mode: 'trace' },
    { id: 'LAW-ObligationCount', mode: 'trace' },
  ],
});

// ---------------------------------------------------------------------------
// RequirementSpec: Top-level requirement for seizu's correctness
// ---------------------------------------------------------------------------

export const seizuCorrectnessRequirement: RequirementSpec = requirementSpec({
  id: 'REQ-SeizuCorrectness',
  name: 'seizu core logic correctness',
  actors: ['developer', 'ci-pipeline'],
  goal: 'seizu のコアロジック（グラフ操作・証拠伝播・義務生成）が仕様通りに動作する',
  given: [
    { id: 'valid-specs', text: '仕様が正しいTypeScript形式で記述されている' },
    { id: 'deps-available', text: 'fast-check が利用可能' },
  ],
  success: [
    {
      id: 'graph-sound',
      text: 'グラフ操作（トポロジカルソート・循環検出・対称性）が正しい',
    },
    { id: 'propagation-correct', text: '証拠伝播が優先順位ルールに従う' },
    {
      id: 'obligations-valid',
      text: '義務IDが固定フォーマットに従い、数が正確',
    },
    {
      id: 'validation-works',
      text: 'グラフ検証が不正な入力を適切にエラーとして返す',
    },
  ],
  failure: [
    { id: 'cycle-undetected', text: '循環依存が検出されない' },
    { id: 'refuted-not-propagated', text: 'REFUTEDが依存先に伝播しない' },
  ],
  forbidden: [
    { id: 'false-proved', text: '不正な仕様がPROVEDになることは許容しない' },
    {
      id: 'silent-failure',
      text: 'エラーが無視されて正常終了することは許容しない',
    },
  ],
  examples: [
    'A→B→C の依存グラフでBがREFUTEDならAもinvalidになる',
    '循環依存 A→B→A を検出してCycleErrorをthrowする',
  ],
  dependsOn: [
    'UC-GraphValidation',
    'LAW-PropagationPriority',
    'LAW-PropagationDepInvalid',
    'LAW-GraphDependencySymmetry',
  ],
});

// Export all specs for discovery
export const specs = [
  // Laws (leaf layer)
  graphTopologicalSortLaw,
  graphCycleDetectionLaw,
  graphDependencySymmetryLaw,
  propagationPriorityLaw,
  propagationDepInvalidLaw,
  obligationIdFormatLaw,
  obligationCountLaw,
  // Usecase (middle layer)
  graphValidationUsecase,
  // Requirement (top layer)
  seizuCorrectnessRequirement,
] as const;
