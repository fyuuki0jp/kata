import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { effect, usecaseSpec } from '../../src/spec';
import { verifyUsecase } from '../../src/verify/usecase-verifier';

describe('verifyUsecase', () => {
  test('marks effect obligations as tested when observe is provided', async () => {
    const spec = usecaseSpec<
      { amount: number },
      { amount: number },
      never,
      { amount: number }
    >({
      id: 'UC-Effect',
      name: 'effect test',
      target: { module: '.', export: 'noop' },
      classifyError: () => 'never',
      given: [],
      ensures: [],
      invariants: [],
      errors: [],
      effects: [
        effect(
          'response-shape',
          'response',
          'response is observed',
          (observed) => observed.response === 'ok'
        ),
      ],
      dependsOn: [],
    });

    const result = await verifyUsecase(spec, {
      setup: async () => ({ deps: {}, cleanup: undefined }),
      inputArbitrary: fc.record({ amount: fc.constant(1) }),
      snapshot: async () => ({ amount: 0 }),
      observe: async () => ({ response: 'ok' }),
      targetFn: async (_deps, input) => ({ ok: true, value: input }),
      numRuns: 3,
    });

    expect(result.obligations).toContainEqual(
      expect.objectContaining({
        obligationId: 'UC-Effect:effect:response-shape:response',
        status: 'TESTED',
      })
    );
  });
});
