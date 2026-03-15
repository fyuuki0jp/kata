// Domain types
export type TransferInput = { from: string; to: string; amount: number };
export type TransferOutput = { transactionId: string };
export type TransferError =
  | { type: 'insufficient_funds' }
  | { type: 'same_account' };
export type Result<O, E> = { ok: true; value: O } | { ok: false; error: E };

export type AccountState = {
  readonly accounts: Record<string, { balance: number }>;
  readonly totalBalance: number;
};

// Pure function: updateBalances
export function updateBalances(
  state: AccountState,
  input: { from: string; to: string; amount: number }
): AccountState {
  const fromBalance = state.accounts[input.from]?.balance ?? 0;
  const toBalance = state.accounts[input.to]?.balance ?? 0;
  return {
    accounts: {
      ...state.accounts,
      [input.from]: { balance: fromBalance - input.amount },
      [input.to]: { balance: toBalance + input.amount },
    },
    totalBalance: state.totalBalance,
  };
}

// Async function: transferFunds (with deps injection)
export async function transferFunds(
  deps: {
    accountRepo: {
      find: (id: string) => Promise<{ balance: number } | null>;
      updateBalances: (
        from: string,
        to: string,
        amount: number
      ) => Promise<void>;
    };
  },
  input: TransferInput
): Promise<Result<TransferOutput, TransferError>> {
  if (input.from === input.to) {
    return { ok: false, error: { type: 'same_account' } };
  }

  const fromAcc = await deps.accountRepo.find(input.from);
  const toAcc = await deps.accountRepo.find(input.to);

  if (!fromAcc || !toAcc || fromAcc.balance < input.amount) {
    return { ok: false, error: { type: 'insufficient_funds' } };
  }

  await deps.accountRepo.updateBalances(input.from, input.to, input.amount);

  return { ok: true, value: { transactionId: `tx-${Date.now()}` } };
}
