import type { SmtResult } from '../smt/ir';
import type {
  ObligationResult,
  ObligationStatus,
  SpecVerifyResult,
} from './spec-types';

/**
 * Merge SMT results (from compile) with PBT results (from verify).
 * PROVED comes from SMT only. TESTED comes from PBT only.
 */
export function mergeEvidence(
  smtResults: readonly SmtResult[],
  pbtResult: SpecVerifyResult
): SpecVerifyResult {
  const smtMap = new Map(smtResults.map((r) => [r.obligationId, r]));
  const merged: ObligationResult[] = [];

  for (const pbt of pbtResult.obligations) {
    const smt = smtMap.get(pbt.obligationId);

    if (smt) {
      // Both SMT and PBT have results for this obligation
      merged.push({
        ...pbt,
        status: mergeStatus(smt.status as ObligationStatus, pbt.status),
      });
      smtMap.delete(pbt.obligationId);
    } else {
      merged.push(pbt);
    }
  }

  // Add SMT-only obligations (e.g., smt:consistency)
  for (const [, smt] of smtMap) {
    merged.push({
      obligationId: smt.obligationId,
      status: smt.status as ObligationStatus,
      counterexample: smt.counterexample,
    });
  }

  return {
    ...pbtResult,
    obligations: merged,
    success: merged.every(
      (r) => r.status === 'TESTED' || r.status === 'PROVED'
    ),
  };
}

function mergeStatus(
  smt: ObligationStatus,
  pbt: ObligationStatus
): ObligationStatus {
  // REFUTED takes priority
  if (smt === 'REFUTED' || pbt === 'REFUTED') return 'REFUTED';
  // PROVED from SMT is the highest positive status
  if (smt === 'PROVED') return 'PROVED';
  // TESTED from PBT
  if (pbt === 'TESTED') return 'TESTED';
  // Otherwise keep whatever we have
  if (smt === 'UNKNOWN' && pbt === 'UNKNOWN') return 'UNKNOWN';
  return pbt;
}
