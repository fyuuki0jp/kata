import * as fc from 'fast-check';
import { effect, ensure, errorClause, usecaseSpec } from 'seizu/spec';
import { transferRoutes } from '../api/transfers';
import type { Transfer, TransferError, TransferInput } from '../domain/types';
import { createDatabase } from '../infra/db';
import { AccountRepository, TransferRepository } from '../infra/repository';

interface RouteState {
  readonly fromBalance: number;
  readonly toBalance: number;
  readonly transferCount: number;
}

interface RouteDeps {
  readonly accountRepo: AccountRepository;
  readonly transferRepo: TransferRepository;
  readonly app: ReturnType<typeof transferRoutes>;
  readonly db: ReturnType<typeof createDatabase>;
  lastResponse?: {
    readonly status: number;
    readonly body: unknown;
  };
}

interface TransferCreatedBody {
  readonly transfer: Transfer;
  readonly fromBalance: number;
  readonly toBalance: number;
}

type TransferRouteSuccess = {
  readonly status: 201;
  readonly body: TransferCreatedBody;
};

type TransferRouteError =
  | {
      readonly type: 'http_400';
      readonly status: 400;
      readonly body: { readonly error: TransferError };
    }
  | {
      readonly type: 'http_404';
      readonly status: 404;
      readonly body: { readonly error: TransferError };
    };

export const inputArbitrary = fc.oneof(
  fc.record({
    fromId: fc.constant('alice'),
    toId: fc.constant('bob'),
    amount: fc.integer({ min: 1, max: 500 }),
  }),
  fc.record({
    fromId: fc.constant('alice'),
    toId: fc.constant('alice'),
    amount: fc.integer({ min: 1, max: 100 }),
  }),
  fc.record({
    fromId: fc.constant('alice'),
    toId: fc.constant('bob'),
    amount: fc.constant(0),
  }),
  fc.record({
    fromId: fc.constant('nonexistent'),
    toId: fc.constant('bob'),
    amount: fc.integer({ min: 1, max: 100 }),
  })
);

export async function setup() {
  const db = createDatabase(':memory:');
  const accountRepo = new AccountRepository(db);
  const transferRepo = new TransferRepository(db);
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

  const app = transferRoutes(accountRepo, transferRepo);
  const deps: RouteDeps = { accountRepo, transferRepo, app, db };

  return {
    deps,
    cleanup: async () => {
      db.close();
    },
  };
}

export async function snapshot(deps: RouteDeps): Promise<RouteState> {
  const alice = deps.accountRepo.findById('alice');
  const bob = deps.accountRepo.findById('bob');
  return {
    fromBalance: alice?.balance ?? 0,
    toBalance: bob?.balance ?? 0,
    transferCount: deps.transferRepo.findAll().length,
  };
}

export async function observe({
  deps,
}: {
  deps: RouteDeps;
}): Promise<{ readonly response?: RouteDeps['lastResponse'] }> {
  return {
    response: deps.lastResponse,
  };
}

export async function invokeCreateTransferRoute(
  deps: RouteDeps,
  input: TransferInput
): Promise<
  | { ok: true; value: TransferRouteSuccess }
  | { ok: false; error: TransferRouteError }
> {
  const response = await deps.app.request('http://localhost/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as unknown;
  deps.lastResponse = { status: response.status, body };

  if (response.status === 201) {
    return {
      ok: true,
      value: {
        status: 201,
        body: body as TransferCreatedBody,
      },
    };
  }

  if (response.status === 404) {
    return {
      ok: false,
      error: {
        type: 'http_404',
        status: 404,
        body: body as { error: TransferError },
      },
    };
  }

  return {
    ok: false,
    error: {
      type: 'http_400',
      status: 400,
      body: body as { error: TransferError },
    },
  };
}

export const createTransferRouteUsecase = usecaseSpec<
  TransferInput,
  TransferRouteSuccess,
  TransferRouteError,
  RouteState
>({
  id: 'UC-CreateTransferRoute',
  name: '送金HTTP API契約',
  target: {
    module: 'src/spec/route.spec',
    export: 'invokeCreateTransferRoute',
  },
  classifyError: (error) => error.type,
  given: [],
  ensures: [
    ensure('http-created', '成功時はHTTP 201を返す', ({ result }) =>
      result.ok ? result.value.status === 201 : true
    ),
    ensure(
      'response-shape',
      '成功時レスポンスは送金結果の形を持つ',
      ({ input, result }) =>
        result.ok
          ? result.value.body.transfer.id.length > 0 &&
            result.value.body.transfer.fromId === input.fromId &&
            result.value.body.transfer.toId === input.toId &&
            result.value.body.transfer.amount === input.amount &&
            result.value.body.transfer.createdAt.length > 0 &&
            result.value.body.fromBalance >= 0 &&
            result.value.body.toBalance >= 0
          : true
    ),
  ],
  invariants: [],
  errors: [
    errorClause(
      'err-http-400',
      'http_400',
      '不正なリクエストはHTTP 400',
      ({ error }) =>
        error.status === 400 &&
        (error.body.error.type === 'same_account' ||
          error.body.error.type === 'invalid_amount' ||
          error.body.error.type === 'insufficient_funds')
    ),
    errorClause(
      'err-http-404',
      'http_404',
      '存在しない口座はHTTP 404',
      ({ error }) =>
        error.status === 404 && error.body.error.type === 'account_not_found'
    ),
  ],
  effects: [
    effect(
      'response-matches-result',
      'response',
      'HTTPレスポンスが返却結果と一致する',
      (observed, { result }) => {
        const response = observed.response as RouteDeps['lastResponse'];
        if (!response) return false;

        if (result.ok) {
          return response.status === 201;
        }

        return response.status === result.error.status;
      }
    ),
  ],
  dependsOn: [{ id: 'UC-CreateTransfer', mode: 'trace' }],
});

export const specs = [createTransferRouteUsecase] as const;
