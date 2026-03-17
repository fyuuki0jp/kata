import * as fc from 'fast-check';
import type { LawSpec } from '../spec/specs';
import type { ObligationResult, SpecVerifyResult } from './spec-types';

export interface LawVerifyOptions {
  readonly numRuns?: number;
  readonly seed?: number;
  readonly path?: string;
  readonly targetFn: (...args: unknown[]) => unknown; // resolved target function
}

export function verifyLaw<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  R = unknown,
>(spec: LawSpec<TArgs, R>, options: LawVerifyOptions): SpecVerifyResult {
  const results: ObligationResult[] = [];
  const numRuns = options.numRuns ?? 100;

  // Build arbitrary from generators (runtime values are fc.Arbitrary<...>)
  const generators = spec.generators as Record<string, fc.Arbitrary<unknown>>;
  const genKeys = Object.keys(generators);
  const genArbs = genKeys.map((k) => generators[k]);
  const argsArb = fc.record(
    Object.fromEntries(genKeys.map((k, i) => [k, genArbs[i]]))
  ) as fc.Arbitrary<TArgs>;

  for (const lawClause of spec.laws) {
    const obligationId = `${spec.id}:law:${lawClause.id}`;

    try {
      fc.assert(
        fc.property(argsArb, (args: TArgs) => {
          // Call target function with generated args
          const argValues = genKeys.map((k) => args[k]);
          const result = options.targetFn(...argValues) as R;
          // Check law predicate
          return lawClause.predicate(args, result);
        }),
        {
          numRuns,
          seed: options.seed,
          path: options.path,
        }
      );

      results.push({
        obligationId,
        status: 'TESTED',
        runs: numRuns,
      });
    } catch (e) {
      // fc.assert throws on failure with counterexample
      const error = e as {
        counterexample?: unknown;
        seed?: number;
        path?: string;
      };
      results.push({
        obligationId,
        status: 'REFUTED',
        runs: numRuns,
        counterexample: error.counterexample,
        seed: error.seed,
        path: error.path,
      });
    }
  }

  return {
    specId: spec.id,
    specKind: 'law',
    obligations: results,
    success: results.every(
      (r) => r.status === 'TESTED' || r.status === 'PROVED'
    ),
  };
}
