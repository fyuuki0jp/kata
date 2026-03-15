import type { ObligationStatus } from '../spec/base';
import type {
  ObligationResult as BaseObligationResult,
  SpecVerifyResult as BaseSpecVerifyResult,
} from '../spec/propagation';

export type { ObligationStatus };

/** Extends base ObligationResult with PBT-specific fields (runs, counterexample, seed, path). */
export interface ObligationResult extends BaseObligationResult {
  readonly runs?: number;
  readonly counterexample?: unknown;
  readonly seed?: number;
  readonly path?: string;
}

/** Extends base SpecVerifyResult with PBT-specific fields (specKind, success). */
export interface SpecVerifyResult extends BaseSpecVerifyResult {
  readonly specKind: string;
  readonly obligations: readonly ObligationResult[];
  readonly success: boolean;
}
