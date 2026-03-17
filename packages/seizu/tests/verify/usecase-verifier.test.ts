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

  test('flags unmatched error tags as refuted', async () => {
    const spec = usecaseSpec<
      { payload: string },
      { ok: boolean; value?: string },
      { payload: string },
      never
    >({
      id: 'UC-Unmatched',
      name: 'unmatched error tag',
      target: { module: '.', export: 'noop' },
      classifyError: (err) =>
        typeof err === 'object' &&
        err &&
        'tag' in (err as Record<string, unknown>)
          ? String((err as { tag: string }).tag)
          : 'unknown',
      given: [],
      ensures: [],
      invariants: [],
      errors: [
        {
          id: 'known-error',
          tag: 'known',
          description: 'known error',
        },
      ],
      effects: [],
      dependsOn: [],
    });

    const result = await verifyUsecase(spec, {
      setup: async () => ({ deps: {}, cleanup: undefined }),
      inputArbitrary: fc.constant({ payload: 'x' }),
      snapshot: async () => ({ payload: 'x' }),
      targetFn: async () => ({ ok: false, error: { tag: 'unexpected' } }),
      numRuns: 1,
    });

    expect(result.obligations).toContainEqual(
      expect.objectContaining({
        obligationId: 'UC-Unmatched:runtime:error_tag',
        status: 'REFUTED',
      })
    );
  });

  test('treats excessive discards as a failed verification run', async () => {
    const spec = usecaseSpec<
      { allow: boolean },
      { ok: boolean; value?: string },
      { allow: boolean },
      never
    >({
      id: 'UC-Discard',
      name: 'discard heavy given',
      target: { module: '.', export: 'noop' },
      classifyError: () => 'never',
      given: [
        {
          id: 'must-allow',
          description: 'allow must be true',
          predicate: ({ input }) => input.allow === true,
        },
      ],
      ensures: [],
      invariants: [],
      errors: [],
      effects: [],
      dependsOn: [],
    });

    const result = await verifyUsecase(spec, {
      setup: async () => ({ deps: {}, cleanup: undefined }),
      inputArbitrary: fc.constant({ allow: false }),
      snapshot: async () => ({ allow: false }),
      targetFn: async () => ({ ok: true, value: 'ok' }),
      numRuns: 5,
      minAcceptedRuns: 1,
      maxDiscardRatio: 1,
    });

    expect(result.success).toBe(false);
    expect(result.obligations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          obligationId: 'UC-Discard:given:must-allow',
          status: 'UNKNOWN',
        }),
      ])
    );
  });

  test('marks runtime:no_throw when the target throws', async () => {
    const spec = usecaseSpec<
      { input: number },
      { ok: boolean; value?: number },
      never,
      { state: number }
    >({
      id: 'UC-Throwing',
      name: 'throws',
      target: { module: '.', export: 'noop' },
      classifyError: () => 'never',
      given: [],
      ensures: [],
      invariants: [],
      errors: [],
      effects: [],
      dependsOn: [],
    });

    const result = await verifyUsecase(spec, {
      setup: async () => ({ deps: {}, cleanup: undefined }),
      inputArbitrary: fc.constant({ input: 1 }),
      snapshot: async () => ({ state: 1 }),
      targetFn: async () => {
        throw new Error('boom');
      },
      numRuns: 1,
    });

    expect(result.success).toBe(false);
    expect(result.obligations).toContainEqual(
      expect.objectContaining({
        obligationId: 'UC-Throwing:runtime:no_throw',
        status: 'REFUTED',
      })
    );
  });

  test('refutes error obligations when predicates fail', async () => {
    const spec = usecaseSpec<
      { value: number },
      { ok: boolean; value?: number },
      { tag: string },
      { value: number }
    >({
      id: 'UC-Error',
      name: 'error refutation',
      target: { module: '.', export: 'noop' },
      classifyError: (err) => (err as { tag: string }).tag,
      given: [],
      ensures: [],
      invariants: [],
      errors: [
        {
          id: 'bad',
          tag: 'bad',
          description: 'always bad',
          predicate: () => false,
        },
      ],
      effects: [],
      dependsOn: [],
    });

    const result = await verifyUsecase(spec, {
      setup: async () => ({ deps: {}, cleanup: undefined }),
      inputArbitrary: fc.constant({ value: 1 }),
      snapshot: async () => ({ value: 1 }),
      targetFn: async () => ({ ok: false, error: { tag: 'bad' } }),
      numRuns: 1,
    });

    expect(result.success).toBe(false);
    expect(result.obligations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          obligationId: 'UC-Error:error:bad',
          status: 'REFUTED',
        }),
        expect.objectContaining({
          obligationId: 'UC-Error:runtime:error_tag',
          status: 'TESTED',
        }),
      ])
    );
  });

  test('marks ensures and invariants as tested on success', async () => {
    const spec = usecaseSpec<
      { amount: number },
      { ok: boolean; value?: number },
      never,
      { before: number; after: number }
    >({
      id: 'UC-Success',
      name: 'happy path',
      target: { module: '.', export: 'noop' },
      classifyError: () => 'never',
      given: [],
      ensures: [
        {
          id: 'positive',
          description: 'result is positive',
          predicate: (_ctx) => true,
        },
      ],
      invariants: [
        {
          id: 'non-negative',
          description: 'state stays non-negative',
          predicate: (_ctx) => true,
        },
      ],
      errors: [],
      effects: [],
      dependsOn: [],
    });

    const result = await verifyUsecase(spec, {
      setup: async () => ({ deps: {}, cleanup: undefined }),
      inputArbitrary: fc.constant({ amount: 2 }),
      snapshot: async () => ({ before: 1, after: 3 }),
      targetFn: async (_deps, input) => ({ ok: true, value: input.amount }),
      numRuns: 1,
    });

    expect(result.success).toBe(true);
    expect(result.obligations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          obligationId: 'UC-Success:ensure:positive',
          status: 'TESTED',
        }),
        expect.objectContaining({
          obligationId: 'UC-Success:invariant:non-negative',
          status: 'TESTED',
        }),
      ])
    );
  });
});
