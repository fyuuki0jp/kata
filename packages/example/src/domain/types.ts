// Result型はseizuから再利用
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly balance: number;
}

export interface Transfer {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly amount: number;
  readonly status: 'completed' | 'failed';
  readonly createdAt: string;
}

export type TransferInput = {
  readonly fromId: string;
  readonly toId: string;
  readonly amount: number;
};

export type TransferOutput = {
  readonly transfer: Transfer;
  readonly fromBalance: number;
  readonly toBalance: number;
};

export type TransferError =
  | { readonly type: 'insufficient_funds' }
  | { readonly type: 'same_account' }
  | { readonly type: 'account_not_found'; readonly accountId: string }
  | { readonly type: 'invalid_amount' };

// State for spec verification
export interface TransferState {
  readonly fromBalance: number;
  readonly toBalance: number;
  readonly totalBalance: number;
}

export type AccountError =
  | { readonly type: 'insufficient_funds' }
  | { readonly type: 'invalid_amount' };
