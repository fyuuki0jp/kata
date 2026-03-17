import * as fc from 'fast-check';
import {
  ensure,
  errorClause,
  given,
  law,
  lawSpec,
  requirementSpec,
  usecaseSpec,
} from '../../../src/spec';
import type {
  AccountState,
  TransferError,
  TransferInput,
  TransferOutput,
} from './implementation';

// Domain types for law spec generators
interface LawArgs {
  from: string;
  to: string;
  amount: number;
  state: AccountState;
}

// RequirementSpec
export const orderRequirement = requirementSpec({
  id: 'REQ-OrderPurchase',
  name: 'Order Purchase',
  actors: ['buyer'],
  goal: 'Transfer funds between accounts',
  given: [
    { id: 'buyer-auth', text: 'Buyer is authenticated' },
    { id: 'accounts-exist', text: 'Both accounts exist' },
  ],
  success: [
    { id: 'balance-preserved', text: 'Total balance is preserved' },
    { id: 'transaction-recorded', text: 'Transaction is recorded' },
  ],
  failure: [
    { id: 'insufficient-funds', text: 'Source account has insufficient funds' },
  ],
  forbidden: [
    {
      id: 'no-negative-balance',
      text: 'Account balance must never go negative',
    },
  ],
  examples: ['Alice transfers 100 to Bob'],
  dependsOn: ['UC-TransferFunds'],
});

// LawSpec
export const updateBalancesLaw = lawSpec<LawArgs, AccountState>({
  id: 'LAW-UpdateBalances',
  name: 'Updating balances preserves total',
  target: { module: './implementation', export: 'updateBalances' },
  generators: {
    from: fc.constantFrom('A', 'B', 'C'),
    to: fc.constantFrom('A', 'B', 'C'),
    amount: fc.integer({ min: 1, max: 1000 }),
    state: fc.constant({
      accounts: {
        A: { balance: 1000 },
        B: { balance: 500 },
        C: { balance: 300 },
      },
      totalBalance: 1800,
    }),
  },
  laws: [
    law<LawArgs, AccountState>(
      'conserve-total',
      'Total balance is preserved after update',
      (args, result) => {
        return result.totalBalance === args.state.totalBalance;
      }
    ),
  ],
  dependsOn: [],
});

// UsecaseSpec
export const transferFundsSpec = usecaseSpec<
  TransferInput,
  TransferOutput,
  TransferError,
  AccountState
>({
  id: 'UC-TransferFunds',
  name: 'Transfer money between accounts',
  target: { module: './implementation', export: 'transferFunds' },
  classifyError: (error) => error.type,
  given: [
    given<TransferInput, AccountState>(
      'amount-positive',
      'Amount is positive',
      ({ input }) => input.amount > 0
    ),
    given<TransferInput, AccountState>(
      'different-accounts',
      'Source and destination differ',
      ({ input }) => input.from !== input.to
    ),
  ],
  ensures: [
    ensure<TransferInput, TransferOutput, TransferError, AccountState>(
      'balance-conservation',
      'Total balance is preserved on success',
      ({ before, after, result }) =>
        result.ok ? before.totalBalance === after.totalBalance : true
    ),
  ],
  invariants: [],
  errors: [
    errorClause('same-account', 'same_account', 'Same account transfer'),
    errorClause(
      'insufficient-funds',
      'insufficient_funds',
      'Insufficient funds'
    ),
  ],
  effects: [],
  dependsOn: ['LAW-UpdateBalances'],
});

// Export all specs
export const specs = [
  orderRequirement,
  updateBalancesLaw,
  transferFundsSpec,
] as const;
