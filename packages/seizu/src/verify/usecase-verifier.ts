import * as fc from 'fast-check';
import type { Result } from '../result';
import { isOk } from '../result';
import type { ObligationResult, SpecVerifyResult } from './spec-types';

// UsecaseSpec-like type (Spike inline)
interface UsecaseSpecLike {
  readonly id: string;
  readonly name: string;
  readonly classifyError: (error: unknown) => string;
  readonly given: readonly {
    readonly id: string;
    readonly predicate: (ctx: { input: unknown; state: unknown }) => boolean;
  }[];
  readonly ensures: readonly {
    readonly id: string;
    readonly predicate: (ctx: {
      before: unknown;
      after: unknown;
      input: unknown;
      result: Result<unknown, unknown>;
    }) => boolean;
  }[];
  readonly invariants: readonly {
    readonly id: string;
    readonly predicate: (ctx: {
      before: unknown;
      after: unknown;
      input: unknown;
      result: Result<unknown, unknown>;
    }) => boolean;
  }[];
  readonly errors: readonly {
    readonly id: string;
    readonly tag: string;
    readonly predicate?: (ctx: {
      input: unknown;
      error: unknown;
      state: unknown;
    }) => boolean;
  }[];
  readonly effects: readonly {
    readonly id: string;
    readonly facet: string;
    readonly predicate: (observed: unknown, ctx: unknown) => boolean;
  }[];
}

export interface UsecaseVerifyOptions {
  readonly setup: () => Promise<{
    deps: unknown;
    cleanup?: () => Promise<void>;
  }>;
  readonly inputArbitrary: fc.Arbitrary<unknown>;
  readonly snapshot: (deps: unknown) => Promise<unknown>;
  readonly observe?: (ctx: {
    deps: unknown;
    before: unknown;
    after: unknown;
    result: Result<unknown, unknown>;
  }) => Promise<unknown>;
  readonly targetFn: (
    deps: unknown,
    input: unknown
  ) => Promise<Result<unknown, unknown>>;
  readonly numRuns?: number;
  readonly seed?: number;
  readonly minAcceptedRuns?: number;
  readonly maxDiscardRatio?: number;
}

export async function verifyUsecase(
  spec: UsecaseSpecLike,
  options: UsecaseVerifyOptions
): Promise<SpecVerifyResult> {
  const numRuns = options.numRuns ?? 100;
  const minAcceptedRuns = options.minAcceptedRuns ?? 1;
  const maxDiscardRatio = options.maxDiscardRatio ?? 10;

  // Track per-obligation results across all runs
  const obligationResults = new Map<string, ObligationResult>();
  // Track how many times each obligation's predicate was actually evaluated
  const evaluationCounts = new Map<string, number>();
  let acceptedRuns = 0;
  let discardedRuns = 0;
  let observedError = false;

  // Initialize all obligations as UNKNOWN with zero evaluation counts
  for (const g of spec.given) {
    const key = `${spec.id}:given:${g.id}`;
    obligationResults.set(key, { obligationId: key, status: 'UNKNOWN' });
    evaluationCounts.set(key, 0);
  }
  for (const e of spec.ensures) {
    const key = `${spec.id}:ensure:${e.id}`;
    obligationResults.set(key, { obligationId: key, status: 'UNKNOWN' });
    evaluationCounts.set(key, 0);
  }
  for (const inv of spec.invariants) {
    const key = `${spec.id}:invariant:${inv.id}`;
    obligationResults.set(key, { obligationId: key, status: 'UNKNOWN' });
    evaluationCounts.set(key, 0);
  }
  for (const e of spec.errors) {
    const key = `${spec.id}:error:${e.id}`;
    obligationResults.set(key, { obligationId: key, status: 'UNKNOWN' });
    evaluationCounts.set(key, 0);
  }
  for (const eff of spec.effects) {
    const key = `${spec.id}:effect:${eff.id}:${eff.facet}`;
    obligationResults.set(key, { obligationId: key, status: 'UNKNOWN' });
    evaluationCounts.set(key, 0);
  }
  const noThrowKey = `${spec.id}:runtime:no_throw`;
  const errorTagKey = `${spec.id}:runtime:error_tag`;
  obligationResults.set(noThrowKey, {
    obligationId: noThrowKey,
    status: 'UNKNOWN',
  });
  obligationResults.set(errorTagKey, {
    obligationId: errorTagKey,
    status: 'UNKNOWN',
  });
  evaluationCounts.set(noThrowKey, 0);
  evaluationCounts.set(errorTagKey, 0);

  try {
    await fc.assert(
      fc.asyncProperty(options.inputArbitrary, async (input: unknown) => {
        const fixture = await options.setup();
        try {
          // 1. snapshot before
          const before = await options.snapshot(fixture.deps);

          // 2. Check given clauses (discard if not met)
          for (const g of spec.given) {
            const givenKey = `${spec.id}:given:${g.id}`;
            evaluationCounts.set(
              givenKey,
              (evaluationCounts.get(givenKey) ?? 0) + 1
            );
            const givenOk = g.predicate({ input, state: before });
            if (!givenOk) {
              discardedRuns++;
            }
            fc.pre(givenOk);
          }

          // 3. Execute target
          let result: Result<unknown, unknown>;
          evaluationCounts.set(
            noThrowKey,
            (evaluationCounts.get(noThrowKey) ?? 0) + 1
          );
          try {
            result = await options.targetFn(fixture.deps, input);
          } catch (e) {
            // target threw → runtime:no_throw REFUTED
            obligationResults.set(`${spec.id}:runtime:no_throw`, {
              obligationId: `${spec.id}:runtime:no_throw`,
              status: 'REFUTED',
              counterexample: { input, error: e },
            });
            return false;
          }

          // 4. snapshot after
          const after = await options.snapshot(fixture.deps);

          const ctx = { before, after, input, result };

          // 5. Check error clauses (if result is error)
          if (!isOk(result)) {
            observedError = true;
            const errorTag = spec.classifyError(result.error);
            const matchingError = spec.errors.find((e) => e.tag === errorTag);
            if (!matchingError) {
              // Unmatched error tag
              evaluationCounts.set(
                errorTagKey,
                (evaluationCounts.get(errorTagKey) ?? 0) + 1
              );
              obligationResults.set(errorTagKey, {
                obligationId: errorTagKey,
                status: 'REFUTED',
                counterexample: {
                  input,
                  error: result.error,
                  tag: errorTag,
                  message: `Error tag "${errorTag}" does not match any ErrorClause`,
                },
              });
              return false;
            }
            if (matchingError.predicate) {
              const errorKey = `${spec.id}:error:${matchingError.id}`;
              evaluationCounts.set(
                errorKey,
                (evaluationCounts.get(errorKey) ?? 0) + 1
              );
              evaluationCounts.set(
                errorTagKey,
                (evaluationCounts.get(errorTagKey) ?? 0) + 1
              );
              obligationResults.set(errorTagKey, {
                obligationId: errorTagKey,
                status: 'TESTED',
              });
              if (
                !matchingError.predicate({
                  input,
                  error: result.error,
                  state: before,
                })
              ) {
                obligationResults.set(errorKey, {
                  obligationId: errorKey,
                  status: 'REFUTED',
                  counterexample: { input, error: result.error },
                });
                return false;
              }
            } else {
              // Error clause matched by tag but has no predicate — count as evaluated
              const errorKey = `${spec.id}:error:${matchingError.id}`;
              evaluationCounts.set(
                errorKey,
                (evaluationCounts.get(errorKey) ?? 0) + 1
              );
              evaluationCounts.set(
                errorTagKey,
                (evaluationCounts.get(errorTagKey) ?? 0) + 1
              );
              obligationResults.set(errorTagKey, {
                obligationId: errorTagKey,
                status: 'TESTED',
              });
            }
          }

          // 6. Check ensures
          for (const e of spec.ensures) {
            const ensureKey = `${spec.id}:ensure:${e.id}`;
            evaluationCounts.set(
              ensureKey,
              (evaluationCounts.get(ensureKey) ?? 0) + 1
            );
            try {
              if (!e.predicate(ctx)) {
                obligationResults.set(`${spec.id}:ensure:${e.id}`, {
                  obligationId: `${spec.id}:ensure:${e.id}`,
                  status: 'REFUTED',
                  counterexample: { input, before, after, result },
                });
                return false;
              }
            } catch (err) {
              obligationResults.set(`${spec.id}:ensure:${e.id}`, {
                obligationId: `${spec.id}:ensure:${e.id}`,
                status: 'REFUTED',
                counterexample: { input, error: err },
              });
              return false;
            }
          }

          // 7. Check invariants
          for (const inv of spec.invariants) {
            const invKey = `${spec.id}:invariant:${inv.id}`;
            evaluationCounts.set(
              invKey,
              (evaluationCounts.get(invKey) ?? 0) + 1
            );
            try {
              if (!inv.predicate(ctx)) {
                obligationResults.set(`${spec.id}:invariant:${inv.id}`, {
                  obligationId: `${spec.id}:invariant:${inv.id}`,
                  status: 'REFUTED',
                  counterexample: { input, before, after, result },
                });
                return false;
              }
            } catch (err) {
              obligationResults.set(`${spec.id}:invariant:${inv.id}`, {
                obligationId: `${spec.id}:invariant:${inv.id}`,
                status: 'REFUTED',
                counterexample: { input, error: err },
              });
              return false;
            }
          }

          // 8. Check effects (if observe is provided)
          if (options.observe && spec.effects.length > 0) {
            const observed = await options.observe({
              deps: fixture.deps,
              before,
              after,
              result,
            });
            for (const eff of spec.effects) {
              const effKey = `${spec.id}:effect:${eff.id}:${eff.facet}`;
              evaluationCounts.set(
                effKey,
                (evaluationCounts.get(effKey) ?? 0) + 1
              );
              try {
                if (
                  !eff.predicate(
                    observed as Parameters<typeof eff.predicate>[0],
                    ctx
                  )
                ) {
                  obligationResults.set(
                    `${spec.id}:effect:${eff.id}:${eff.facet}`,
                    {
                      obligationId: `${spec.id}:effect:${eff.id}:${eff.facet}`,
                      status: 'REFUTED',
                      counterexample: { input, observed },
                    }
                  );
                  return false;
                }
              } catch (err) {
                obligationResults.set(
                  `${spec.id}:effect:${eff.id}:${eff.facet}`,
                  {
                    obligationId: `${spec.id}:effect:${eff.id}:${eff.facet}`,
                    status: 'REFUTED',
                    counterexample: { input, error: err },
                  }
                );
                return false;
              }
            }
          }

          acceptedRuns++;

          return true;
        } finally {
          await fixture.cleanup?.();
        }
      }),
      { numRuns, seed: options.seed }
    );

    // Check discard threshold
    if (
      acceptedRuns < minAcceptedRuns ||
      discardedRuns > acceptedRuns * maxDiscardRatio
    ) {
      // All obligations stay UNKNOWN
      return {
        specId: spec.id,
        specKind: 'usecase',
        obligations: [...obligationResults.values()],
        success: false,
      };
    }

    if (
      !observedError &&
      acceptedRuns > 0 &&
      (obligationResults.get(errorTagKey)?.status ?? 'UNKNOWN') === 'UNKNOWN'
    ) {
      obligationResults.set(errorTagKey, {
        obligationId: errorTagKey,
        status: 'TESTED',
        runs: acceptedRuns,
      });
      evaluationCounts.set(errorTagKey, acceptedRuns);
    }

    // Mark obligations as TESTED only if their predicate was actually evaluated
    for (const [id, result] of obligationResults) {
      if (result.status === 'UNKNOWN') {
        const evalCount = evaluationCounts.get(id) ?? 0;
        if (evalCount > 0) {
          obligationResults.set(id, {
            ...result,
            status: 'TESTED',
            runs: acceptedRuns,
          });
        }
        // evalCount === 0 → leave as UNKNOWN
      }
    }
  } catch (_e) {
    // fc.assert threw (counterexample found)
    // obligations that were REFUTED during runs are already marked
  }

  return {
    specId: spec.id,
    specKind: 'usecase',
    obligations: [...obligationResults.values()],
    success: [...obligationResults.values()].every(
      (r) => r.status === 'TESTED' || r.status === 'PROVED'
    ),
  };
}
