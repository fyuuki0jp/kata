export type ObligationStatus =
  | 'PROVED'
  | 'TESTED'
  | 'REFUTED'
  | 'UNKNOWN'
  | 'ASSUMED';

export interface ObligationResult {
  readonly obligationId: string;
  readonly status: ObligationStatus;
  readonly runs?: number;
  readonly counterexample?: unknown;
  readonly seed?: number;
  readonly path?: string;
}

export interface SpecVerifyResult {
  readonly specId: string;
  readonly specKind: string;
  readonly obligations: readonly ObligationResult[];
  readonly success: boolean;
}
