import { Hono } from 'hono';
import { applyTransfer } from '../domain/transfer';
import type {
  Result,
  TransferError,
  TransferInput,
  TransferOutput,
  TransferState,
} from '../domain/types';
import type {
  AccountRepository,
  TransferRepository,
} from '../infra/repository';

/**
 * Create a transfer between accounts.
 * This is the UseCase target function — it wraps the pure domain logic
 * with DB side effects.
 */
export async function createTransfer(
  deps: { accountRepo: AccountRepository; transferRepo: TransferRepository },
  input: TransferInput
): Promise<Result<TransferOutput, TransferError>> {
  const fromAccount = deps.accountRepo.findById(input.fromId);
  if (!fromAccount) {
    return {
      ok: false,
      error: { type: 'account_not_found', accountId: input.fromId },
    };
  }

  const toAccount = deps.accountRepo.findById(input.toId);
  if (!toAccount) {
    return {
      ok: false,
      error: { type: 'account_not_found', accountId: input.toId },
    };
  }

  const state: TransferState = {
    fromBalance: fromAccount.balance,
    toBalance: toAccount.balance,
    totalBalance: fromAccount.balance + toAccount.balance,
  };

  // Call pure domain function
  const result = applyTransfer(state, input);
  if (!result.ok) {
    deps.transferRepo.create(input.fromId, input.toId, input.amount, 'failed');
    return result;
  }

  // Apply side effects
  deps.accountRepo.updateBalance(input.fromId, result.value.fromBalance);
  deps.accountRepo.updateBalance(input.toId, result.value.toBalance);
  const transfer = deps.transferRepo.create(
    input.fromId,
    input.toId,
    input.amount,
    'completed'
  );

  return {
    ok: true,
    value: {
      transfer,
      fromBalance: result.value.fromBalance,
      toBalance: result.value.toBalance,
    },
  };
}

export function transferRoutes(
  accountRepo: AccountRepository,
  transferRepo: TransferRepository
) {
  const app = new Hono();

  app.get('/', (c) => {
    const transfers = transferRepo.findAll();
    return c.json(transfers);
  });

  app.post('/', async (c) => {
    const body = await c.req.json<TransferInput>();
    const result = await createTransfer({ accountRepo, transferRepo }, body);
    if (!result.ok) {
      const status = result.error.type === 'account_not_found' ? 404 : 400;
      return c.json({ error: result.error }, status);
    }
    return c.json(result.value, 201);
  });

  return app;
}
