import type { Result } from '../result';

export interface EffectEvidence {
  readonly dbDiff?: Record<string, unknown>;
  readonly emittedEvents?: readonly unknown[];
  readonly sideEffects?: readonly string[];
}

export interface ExecutionHarness<D, I, O, E, S> {
  readonly snapshot: (deps: D) => Promise<S>;
  readonly execute: (deps: D, input: I) => Promise<Result<O, E>>;
  readonly observe?: (
    before: S,
    after: S,
    result: Result<O, E>
  ) => Promise<EffectEvidence>;
}
