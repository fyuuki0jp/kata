export type { LawVerifyOptions } from './law-verifier';
export { verifyLaw } from './law-verifier';
export type { ContractEntry, RunnerOptions } from './runner';
export { verify, verifyContract } from './runner';
// Spec verification exports
export type {
  ObligationResult as SpecObligationResult,
  ObligationStatus,
  SpecVerifyResult,
} from './spec-types';
export { mergeEvidence } from './spec-verifier';
export type {
  CheckKind,
  CheckResult,
  ContractResult,
  VerifyResult,
  ViolationKind,
} from './types';
export type { UsecaseVerifyOptions } from './usecase-verifier';
export { verifyUsecase } from './usecase-verifier';

import type { Arbitrary } from 'fast-check';
import type { Contract } from '../types';
import type { RunnerOptions } from './runner';
import { verifyContract } from './runner';

export function assertContractValid<TState, TInput, TError>(
  contract: Contract<TState, TInput, TError>,
  arbitraries: {
    state: Arbitrary<TState>;
    input: Arbitrary<TInput>;
  },
  options?: RunnerOptions
): void {
  const result = verifyContract(
    {
      contract: contract as Contract<unknown, unknown, unknown>,
      state: arbitraries.state as Arbitrary<unknown>,
      input: arbitraries.input as Arbitrary<unknown>,
    },
    options
  );
  const failures = result.checks.filter((c) => c.status === 'failed');
  if (failures.length > 0) {
    const messages = failures.map((f) => {
      const violationLabel = f.violation ?? 'unknown violation';
      const details: string[] = [];
      if (f.reason !== undefined) {
        details.push(`reason: ${f.reason}`);
      }
      if (f.seed !== undefined) {
        details.push(`seed: ${f.seed}`);
      }
      if (f.path !== undefined) {
        details.push(`path: ${f.path}`);
      }
      const detailsSuffix =
        details.length > 0 ? ` (${details.join(', ')})` : '';
      return `  [${violationLabel}] ${f.id}${detailsSuffix}`;
    });
    throw new Error(
      `Contract "${contract.name}" has ${failures.length} violation(s):\n${messages.join('\n')}`
    );
  }
}
