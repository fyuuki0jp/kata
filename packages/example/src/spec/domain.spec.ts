import * as fc from 'fast-check';
import { law, lawSpec } from 'seizu/spec';

// ---- Types for generators ----
interface DebitArgs {
  balance: number;
  amount: number;
}

interface CreditArgs {
  balance: number;
  amount: number;
}

interface TransferArgs {
  state: { fromBalance: number; toBalance: number; totalBalance: number };
  input: { fromId: string; toId: string; amount: number };
}

// ---- LAW: debit preserves non-negativity ----
export const debitNonNegativeLaw = lawSpec<
  DebitArgs,
  { ok: boolean; value?: number }
>({
  id: 'LAW-DebitNonNegative',
  name: '引き落とし後の残高は非負',
  target: { module: 'src/domain/account', export: 'debit' },
  generators: {
    balance: fc.integer({ min: 0, max: 100000 }),
    amount: fc.integer({ min: 1, max: 100000 }),
  },
  laws: [
    law('non-negative', '成功時は残高 >= 0', (_args, result) =>
      result.ok ? (result.value ?? 0) >= 0 : true
    ),
    law('debit-amount', '成功時は残高が正確にamount分減る', (args, result) =>
      result.ok ? result.value === args.balance - args.amount : true
    ),
    law('insufficient-rejects', '残高不足時はエラー', (args, result) =>
      args.balance < args.amount ? !result.ok : true
    ),
  ],
  dependsOn: [],
});

// ---- LAW: credit always succeeds for positive amounts ----
export const creditAlwaysSucceedsLaw = lawSpec<
  CreditArgs,
  { ok: boolean; value?: number }
>({
  id: 'LAW-CreditAlwaysSucceeds',
  name: '入金は正の金額で常に成功',
  target: { module: 'src/domain/account', export: 'credit' },
  generators: {
    balance: fc.integer({ min: 0, max: 100000 }),
    amount: fc.integer({ min: 1, max: 100000 }),
  },
  laws: [
    law('always-succeeds', '正の金額なら成功', (args, result) =>
      args.amount > 0 ? result.ok === true : true
    ),
    law(
      'credit-amount',
      '成功時は残高が正確にamount分増える',
      (args, result) =>
        result.ok ? result.value === args.balance + args.amount : true
    ),
  ],
  dependsOn: [],
});

// ---- LAW: applyTransfer conserves total balance ----
export const transferConservationLaw = lawSpec<
  TransferArgs,
  {
    ok: boolean;
    value?: { fromBalance: number; toBalance: number; totalBalance: number };
  }
>({
  id: 'LAW-TransferConservation',
  name: '送金は合計残高を保存する',
  target: { module: 'src/domain/transfer', export: 'applyTransfer' },
  generators: {
    state: fc
      .record({
        fromBalance: fc.integer({ min: 0, max: 10000 }),
        toBalance: fc.integer({ min: 0, max: 10000 }),
        totalBalance: fc.integer({ min: 0, max: 20000 }), // will be overridden
      })
      .map((s) => ({ ...s, totalBalance: s.fromBalance + s.toBalance })),
    input: fc.record({
      fromId: fc.constant('alice'),
      toId: fc.constant('bob'),
      amount: fc.integer({ min: 1, max: 10000 }),
    }),
  },
  laws: [
    law('conserve-total', '成功時の合計残高は不変', (args, result) =>
      result.ok ? result.value?.totalBalance === args.state.totalBalance : true
    ),
    law('from-debited', '成功時は送金元からamount引かれる', (args, result) =>
      result.ok
        ? result.value?.fromBalance ===
          args.state.fromBalance - args.input.amount
        : true
    ),
    law('to-credited', '成功時は送金先にamount加わる', (args, result) =>
      result.ok
        ? result.value?.toBalance === args.state.toBalance + args.input.amount
        : true
    ),
    law('same-account-rejected', '同一口座送金はエラー', (args, result) =>
      args.input.fromId === args.input.toId ? !result.ok : true
    ),
  ],
  dependsOn: ['LAW-DebitNonNegative', 'LAW-CreditAlwaysSucceeds'],
});

export const specs = [
  debitNonNegativeLaw,
  creditAlwaysSucceedsLaw,
  transferConservationLaw,
] as const;
