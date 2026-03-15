import * as fc from 'fast-check';
import type { ObligationResult, SpecVerifyResult } from './spec-types';

// LawSpec型（別エージェントが作成中のspecs.tsに依存）
// Spikeではインラインで型を定義
interface LawSpecLike {
  readonly id: string;
  readonly name: string;
  readonly target: { module: string; export: string };
  readonly generators: Record<string, fc.Arbitrary<unknown>>;
  readonly laws: readonly {
    readonly id: string;
    readonly description: string;
    readonly predicate: (
      args: Record<string, unknown>,
      result: unknown
    ) => boolean;
  }[];
}

export interface LawVerifyOptions {
  readonly numRuns?: number;
  readonly seed?: number;
  readonly path?: string;
  readonly targetFn: (...args: unknown[]) => unknown; // resolved target function
}

export function verifyLaw(
  spec: LawSpecLike,
  options: LawVerifyOptions
): SpecVerifyResult {
  const results: ObligationResult[] = [];
  const numRuns = options.numRuns ?? 100;

  // Build arbitrary from generators
  const genKeys = Object.keys(spec.generators);
  const genArbs = genKeys.map((k) => spec.generators[k]);
  const argsArb = fc.record(
    Object.fromEntries(genKeys.map((k, i) => [k, genArbs[i]]))
  );

  for (const lawClause of spec.laws) {
    const obligationId = `${spec.id}:law:${lawClause.id}`;

    try {
      fc.assert(
        fc.property(argsArb, (args: Record<string, unknown>) => {
          // Call target function with generated args
          const argValues = genKeys.map((k) => args[k]);
          const result = options.targetFn(...argValues);
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
