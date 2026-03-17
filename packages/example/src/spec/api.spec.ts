import * as fc from 'fast-check';
import {
  effect,
  ensure,
  errorClause,
  given,
  invariant,
  requirementSpec,
  usecaseSpec,
} from 'seizu/spec';
import type {
  Transfer,
  TransferError,
  TransferInput,
  TransferOutput,
} from '../domain/types';
import { createDatabase } from '../infra/db';
import { AccountRepository, TransferRepository } from '../infra/repository';

interface TransferServiceState {
  readonly fromBalance: number;
  readonly toBalance: number;
  readonly totalBalance: number;
  readonly transferCount: number;
}

interface TransferObservation {
  readonly dbDiff?: {
    readonly latestTransfer?: Transfer;
  };
}

// ---- InputArbitrary for PBT ----
export const inputArbitrary = fc.oneof(
  // Normal transfer (success)
  fc.record({
    fromId: fc.constant('alice'),
    toId: fc.constant('bob'),
    amount: fc.integer({ min: 1, max: 500 }),
  }),
  // Same account → same_account error
  fc.record({
    fromId: fc.constant('alice'),
    toId: fc.constant('alice'),
    amount: fc.integer({ min: 1, max: 100 }),
  }),
  // Insufficient funds → insufficient_funds error
  fc.record({
    fromId: fc.constant('alice'),
    toId: fc.constant('bob'),
    amount: fc.integer({ min: 5001, max: 10000 }),
  }),
  // Invalid amount → invalid_amount error
  fc.record({
    fromId: fc.constant('alice'),
    toId: fc.constant('bob'),
    amount: fc.constant(0),
  }),
  // Account not found → account_not_found error
  fc.record({
    fromId: fc.constant('nonexistent'),
    toId: fc.constant('bob'),
    amount: fc.integer({ min: 1, max: 100 }),
  })
);

// ---- Setup/Snapshot for UsecaseSpec PBT ----
export async function setup() {
  const db = createDatabase(':memory:');
  const accountRepo = new AccountRepository(db);
  const transferRepo = new TransferRepository(db);
  // Seed test accounts
  accountRepo.create('alice', 5000);
  accountRepo.create('bob', 3000);
  // Find created accounts to get IDs (they're UUIDs, but we use names as IDs for spec)
  const accounts = accountRepo.findAll();
  const _alice = accounts.find((a) => a.name === 'alice');
  const _bob = accounts.find((a) => a.name === 'bob');

  // Re-create with known IDs for test predictability
  db.exec('DELETE FROM accounts');
  db.prepare('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)').run(
    'alice',
    'Alice',
    5000
  );
  db.prepare('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)').run(
    'bob',
    'Bob',
    3000
  );

  return {
    deps: { accountRepo, transferRepo },
    cleanup: async () => {
      db.close();
    },
  };
}

export async function snapshot(deps: {
  accountRepo: AccountRepository;
  transferRepo: TransferRepository;
}) {
  const accounts = deps.accountRepo.findAll();
  const alice = accounts.find((a) => a.id === 'alice');
  const bob = accounts.find((a) => a.id === 'bob');
  const transfers = deps.transferRepo.findAll();
  return {
    fromBalance: alice?.balance ?? 0,
    toBalance: bob?.balance ?? 0,
    totalBalance: (alice?.balance ?? 0) + (bob?.balance ?? 0),
    transferCount: transfers.length,
  } satisfies TransferServiceState;
}

export async function observe({
  deps,
}: {
  deps: { transferRepo: TransferRepository };
}): Promise<TransferObservation> {
  return {
    dbDiff: {
      latestTransfer: deps.transferRepo.findAll()[0],
    },
  };
}

// ---- UsecaseSpec: createTransfer ----
export const createTransferUsecase = usecaseSpec<
  TransferInput,
  TransferOutput,
  TransferError,
  TransferServiceState
>({
  id: 'UC-CreateTransfer',
  name: '送金API',
  target: { module: 'src/api/transfers', export: 'createTransfer' },
  classifyError: (error: TransferError) => error.type,
  given: [
    given<TransferInput, TransferServiceState>(
      'non-empty-ids',
      '口座IDが空でない',
      ({ input }) => input.fromId.length > 0 && input.toId.length > 0
    ),
  ],
  ensures: [
    ensure<TransferInput, TransferOutput, TransferError, TransferServiceState>(
      'balance-preserved',
      '成功時に合計残高が保存される',
      ({ before, after, result }) =>
        result.ok ? before.totalBalance === after.totalBalance : true
    ),
    ensure<TransferInput, TransferOutput, TransferError, TransferServiceState>(
      'from-debited',
      '成功時に送金元から引き落とされる',
      ({ before, after, input, result }) =>
        result.ok
          ? after.fromBalance === before.fromBalance - input.amount
          : true
    ),
    ensure<TransferInput, TransferOutput, TransferError, TransferServiceState>(
      'to-credited',
      '成功時に送金先へ入金される',
      ({ before, after, input, result }) =>
        result.ok ? after.toBalance === before.toBalance + input.amount : true
    ),
  ],
  invariants: [
    invariant<
      TransferInput,
      TransferOutput,
      TransferError,
      TransferServiceState
    >('non-negative-balance', '成功時に残高が非負', ({ after, result }) =>
      result.ok ? after.fromBalance >= 0 && after.toBalance >= 0 : true
    ),
  ],
  errors: [
    errorClause<TransferInput, TransferError, TransferServiceState>(
      'err-funds',
      'insufficient_funds',
      '残高不足',
      ({ error }) => error.type === 'insufficient_funds'
    ),
    errorClause<TransferInput, TransferError, TransferServiceState>(
      'err-same',
      'same_account',
      '同一口座',
      ({ error }) => error.type === 'same_account'
    ),
    errorClause<TransferInput, TransferError, TransferServiceState>(
      'err-not-found',
      'account_not_found',
      '口座が見つからない',
      ({ error }) => error.type === 'account_not_found'
    ),
    errorClause<TransferInput, TransferError, TransferServiceState>(
      'err-amount',
      'invalid_amount',
      '不正な金額',
      ({ error }) => error.type === 'invalid_amount'
    ),
  ],
  effects: [
    effect<TransferInput, TransferOutput, TransferError, TransferServiceState>(
      'recorded',
      'dbDiff',
      '成功時に送金履歴が記録される',
      (observed, { before, after, input, result }) => {
        if (!result.ok) return true;

        const latestTransfer = (observed as TransferObservation).dbDiff
          ?.latestTransfer;
        return (
          after.transferCount === before.transferCount + 1 &&
          latestTransfer?.status === 'completed' &&
          latestTransfer.fromId === input.fromId &&
          latestTransfer.toId === input.toId &&
          latestTransfer.amount === input.amount
        );
      }
    ),
  ],
  dependsOn: [{ id: 'LAW-TransferConservation', mode: 'trace' }],
});

// ---- RequirementSpec: 送金サービスの要件 ----
export const moneyTransferRequirement = requirementSpec({
  id: 'REQ-MoneyTransfer',
  name: '送金サービス要件',
  actors: ['user'],
  goal: '口座間で安全に資金を移動する',
  given: [
    { id: 'authenticated', text: 'ユーザーが認証済み' },
    { id: 'accounts-exist', text: '送金元・送金先の口座が存在する' },
  ],
  success: [
    { id: 'balance-preserved', text: '合計残高が保存される' },
    { id: 'from-debited', text: '送金元の残高が減る' },
    { id: 'to-credited', text: '送金先の残高が増える' },
    { id: 'recorded', text: '送金履歴が記録される' },
  ],
  failure: [
    { id: 'insufficient-funds', text: '残高不足で送金失敗' },
    { id: 'same-account', text: '同一口座への送金は拒否' },
  ],
  forbidden: [
    { id: 'negative-balance', text: '残高が負にならない' },
    { id: 'money-creation', text: '送金で金額が増えない（合計保存）' },
  ],
  examples: [
    'Alice(残高5000)がBob(残高3000)に1000円送金 → Alice(4000), Bob(4000)',
    'Alice(残高100)がBob(残高3000)に1000円送金 → 残高不足エラー',
  ],
  dependsOn: ['UC-CreateTransfer', 'UC-CreateTransferRoute'],
});

export const specs = [createTransferUsecase, moneyTransferRequirement] as const;
