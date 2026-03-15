/** A branded string that uniquely identifies a spec. */
export type SpecId = string & { readonly __brand: 'SpecId' };

export function specId(id: string): SpecId {
  return id as SpecId;
}

export type SpecKind = 'requirement' | 'scenario' | 'usecase' | 'model' | 'law';

export const ObligationStatus = {
  PROVED: 'PROVED',
  TESTED: 'TESTED',
  REFUTED: 'REFUTED',
  UNKNOWN: 'UNKNOWN',
  ASSUMED: 'ASSUMED',
} as const;

export type ObligationStatus =
  (typeof ObligationStatus)[keyof typeof ObligationStatus];

export interface Obligation {
  readonly id: string;
  readonly specId: SpecId;
  readonly clauseId: string;
  readonly description: string;
  readonly status: ObligationStatus;
}

export interface SpecMetadata {
  readonly id: SpecId;
  readonly name: string;
  readonly kind: SpecKind;
  readonly dependsOn: readonly SpecId[];
}

export interface BaseSpec extends SpecMetadata {}

// AnySpec is now defined in ./specs.ts
