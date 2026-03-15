import { describe, expect, test } from 'vitest';
import type { SpecVerifyResult } from '../src/spec';
import {
  generateObligations,
  law,
  lawSpec,
  propagateEvidence,
  RefinementGraph,
  usecaseSpec,
} from '../src/spec';

describe('spec dependency modes', () => {
  test('trace dependencies do not create refinement obligations', () => {
    const spec = usecaseSpec({
      id: 'UC-TraceOnly',
      name: 'trace only',
      target: { module: '.', export: 'noop' },
      classifyError: () => 'err',
      given: [],
      ensures: [],
      invariants: [],
      errors: [],
      effects: [],
      dependsOn: [{ id: 'LAW-Trace', mode: 'trace' }],
    });

    const obligationIds = generateObligations(spec).map(
      (obligation) => obligation.id
    );

    expect(obligationIds).not.toContain(
      'UC-TraceOnly:smt:refinement:LAW-Trace'
    );
  });

  test('trace dependencies do not invalidate propagation', () => {
    const traceLaw = lawSpec({
      id: 'LAW-Trace',
      name: 'trace law',
      target: { module: '.', export: 'noop' },
      generators: {},
      laws: [law('ok', 'ok', () => true)],
      dependsOn: [],
    });
    const usecase = usecaseSpec({
      id: 'UC-TraceOnly',
      name: 'trace only',
      target: { module: '.', export: 'noop' },
      classifyError: () => 'err',
      given: [],
      ensures: [],
      invariants: [],
      errors: [],
      effects: [],
      dependsOn: [{ id: 'LAW-Trace', mode: 'trace' }],
    });

    const graph = new RefinementGraph();
    graph.addAll([traceLaw, usecase]);

    const results = new Map<string, SpecVerifyResult>();
    results.set('UC-TraceOnly', {
      specId: 'UC-TraceOnly',
      obligations: [
        { obligationId: 'UC-TraceOnly:runtime:no_throw', status: 'TESTED' },
        { obligationId: 'UC-TraceOnly:smt:consistency', status: 'PROVED' },
        {
          obligationId: 'UC-TraceOnly:smt:error_completeness',
          status: 'PROVED',
        },
      ],
    });

    const evidence = propagateEvidence(graph, results);
    expect(evidence.get('UC-TraceOnly')?.status).toBe('valid');
  });
});
