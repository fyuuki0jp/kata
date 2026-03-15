import { credit, debit } from './account';
import type {
  Result,
  TransferError,
  TransferInput,
  TransferState,
} from './types';

/**
 * Apply a transfer to the state.
 * Pure function — computes new balances without side effects.
 */
export function applyTransfer(
  state: TransferState,
  input: TransferInput
): Result<TransferState, TransferError> {
  if (input.amount <= 0) {
    return { ok: false, error: { type: 'invalid_amount' } };
  }
  if (input.fromId === input.toId) {
    return { ok: false, error: { type: 'same_account' } };
  }

  const debitResult = debit(state.fromBalance, input.amount);
  if (!debitResult.ok) {
    return { ok: false, error: { type: 'insufficient_funds' } };
  }

  const creditResult = credit(state.toBalance, input.amount);
  if (!creditResult.ok) {
    return { ok: false, error: creditResult.error };
  }

  return {
    ok: true,
    value: {
      fromBalance: debitResult.value,
      toBalance: creditResult.value,
      totalBalance: state.totalBalance,
    },
  };
}
