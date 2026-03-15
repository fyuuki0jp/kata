import type { AccountError, Result } from './types';

/**
 * Debit an account (withdraw money).
 * Pure function — no side effects.
 */
export function debit(
  balance: number,
  amount: number
): Result<number, AccountError> {
  if (amount <= 0) return { ok: false, error: { type: 'invalid_amount' } };
  if (balance < amount)
    return { ok: false, error: { type: 'insufficient_funds' } };
  return { ok: true, value: balance - amount };
}

/**
 * Credit an account (deposit money).
 * Pure function — no side effects.
 */
export function credit(
  balance: number,
  amount: number
): Result<number, AccountError> {
  if (amount <= 0) return { ok: false, error: { type: 'invalid_amount' } };
  return { ok: true, value: balance + amount };
}
