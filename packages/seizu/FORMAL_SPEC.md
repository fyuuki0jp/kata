# seizu Formal Specification System

seizu v3 の形式仕様システムは、TypeScript アプリケーションの正しさを**数学的に証明**し、**実験的に検証**するためのフレームワークです。

## なぜ seizu なのか

PBT（プロパティベーステスト）だけなら fast-check を直接使えば十分です。seizu の存在意義は:

- **PROVED** — SMT ソルバー（Z3）による数学的証明。反例が存在しないことを保証
- **TESTED** — PBT による実験的確認。高い確度だが証明ではない

この2つの区別を提供し、依存グラフを通じて検証状態を伝播・可視化することです。

```
LawSpec (合計保存の法則)
  → PBT で TESTED（実装が法則を満たすか確認）
  → SMT で PROVED（法則群が矛盾しないか証明）

UsecaseSpec (送金ユースケース)
  → ASSUME: 法則が正しい（PBT で TESTED 済み）
  → PROVE: 法則を前提に、ユースケースの ensures が成立するか
  → SMT 証明 → PROVED
```

---

## クイックスタート

### 1. 仕様を書く

```typescript
// specs/transfer.spec.ts
import * as fc from 'fast-check';
import {
  lawSpec, usecaseSpec, requirementSpec,
  law, given, ensure, errorClause,
} from 'seizu/spec';

// ── 純粋関数の法則 ──────────────────────────────
export const balanceLaw = lawSpec({
  id: 'LAW-BalanceConservation',
  name: '残高の合計は更新操作で変化しない',
  target: { module: './implementation', export: 'updateBalances' },
  generators: {
    from:   fc.constantFrom('alice', 'bob'),
    to:     fc.constantFrom('alice', 'bob'),
    amount: fc.integer({ min: 1, max: 10000 }),
    state:  fc.constant({
      accounts: { alice: { balance: 5000 }, bob: { balance: 3000 } },
      totalBalance: 8000,
    }),
  },
  laws: [
    law(
      'conserve-total',
      '合計残高は操作の前後で不変',
      (args, result) => result.totalBalance === args.state.totalBalance,
    ),
  ],
  dependsOn: [],
});

// ── ユースケース仕様 ─────────────────────────────
export const transferSpec = usecaseSpec({
  id: 'UC-Transfer',
  name: '口座間送金',
  target: { module: './implementation', export: 'transfer' },
  classifyError: (error: { type: string }) => error.type,
  given: [
    given('positive-amount', '送金額は正', ({ input }) => input.amount > 0),
    given('different-accounts', '送金元と送金先が異なる', ({ input }) => input.from !== input.to),
  ],
  ensures: [
    ensure('balance-preserved', '成功時に合計残高が保存される', ({ before, after, result }) =>
      result.ok ? before.totalBalance === after.totalBalance : true,
    ),
  ],
  invariants: [],
  errors: [
    errorClause('err-same', 'same_account', '同一口座への送金'),
    errorClause('err-funds', 'insufficient_funds', '残高不足'),
  ],
  effects: [],
  dependsOn: ['LAW-BalanceConservation'],
});

// ── 要件（トレーサビリティ用）─────────────────────
export const requirement = requirementSpec({
  id: 'REQ-Transfer',
  name: '送金要件',
  actors: ['buyer'],
  goal: '口座間で資金を移動する',
  given:     [{ id: 'auth', text: 'ユーザーが認証済み' }],
  success:   [{ id: 'done', text: '送金が完了し記録される' }],
  failure:   [{ id: 'no-funds', text: '残高不足で失敗' }],
  forbidden: [{ id: 'negative', text: '残高がマイナスにならない' }],
  examples:  ['Alice が Bob に 1000 円送金する'],
  dependsOn: ['UC-Transfer'],
});

// 全仕様をエクスポート（seizu compile が検出する）
export const specs = [balanceLaw, transferSpec, requirement] as const;
```

### 2. 設定を書く

```typescript
// seizu.config.ts
export default {
  title: 'Transfer Service',
  contracts: [],
  verify: { contracts: [] },
  formalSpec: {
    entrypoints: ['specs/transfer.spec.ts'],
    artifactDir: '.seizu',
  },
};
```

### 3. パイプラインを実行する

```bash
# 仕様をコンパイル（グラフ構築 + SMT 証明）
seizu compile

# PBT で実装を検証
seizu verify --specs

# ドキュメント生成（Mermaid 依存グラフ + 証拠テーブル）
seizu doc --specs --output docs/specs.md
```

---

## 3 つの Spec 型

### RequirementSpec — 要件のトレーサビリティ

人間向けのメタデータ。実行可能な検証ロジックは持たない。下位 Spec への依存を宣言し、トレーサビリティを提供する。

```typescript
const req = requirementSpec({
  id: 'REQ-OrderPurchase',
  name: '注文購入',
  actors: ['buyer', 'admin'],
  goal: '商品を購入する',
  given:     [{ id: 'stock-ok',   text: '在庫が十分にある' }],
  success:   [{ id: 'order-done', text: '注文が確定する' }],
  failure:   [{ id: 'no-stock',   text: '在庫切れで失敗' }],
  forbidden: [{ id: 'double-charge', text: '二重課金されない' }],
  examples:  ['10 個の商品を購入する'],
  dependsOn: ['UC-PlaceOrder'],  // UsecaseSpec への依存
});
```

### LawSpec — 純粋関数の代数的法則

純粋関数に対して「常に成り立つべき性質」を宣言する。PBT でランダム入力を生成し検証する。

```typescript
const sortLaw = lawSpec({
  id: 'LAW-SortIdempotent',
  name: 'ソートは冪等',
  target: { module: './utils', export: 'sortItems' },
  generators: {
    items: fc.array(fc.integer(), { minLength: 0, maxLength: 100 }),
  },
  laws: [
    law(
      'idempotent',
      '2 回ソートしても結果が変わらない',
      (args, result) => {
        const sorted = result as number[];
        const reSorted = [...sorted].sort((a, b) => a - b);
        return JSON.stringify(sorted) === JSON.stringify(reSorted);
      },
    ),
    law(
      'preserves-length',
      'ソート前後で要素数が変わらない',
      (args, result) => (result as number[]).length === args.items.length,
    ),
  ],
  dependsOn: [],
});
```

### UsecaseSpec — バックエンド操作の仕様

非同期操作（API エンドポイント、ドメインコマンド等）の事前条件・事後条件・不変条件・エラー条件を宣言する。

```typescript
const createOrderSpec = usecaseSpec({
  id: 'UC-CreateOrder',
  name: '注文作成',
  target: { module: './orders', export: 'createOrder' },

  // エラーを文字列タグに分類する関数
  classifyError: (error: OrderError) => error.type,

  // 事前条件 — false なら PBT の run を discard
  given: [
    given('has-items', 'カートが空でない', ({ input }) => input.items.length > 0),
    given('positive-total', '合計が正', ({ input }) => input.total > 0),
  ],

  // 事後条件 — 実行後に成り立つべきこと
  ensures: [
    ensure('order-created', '成功時に注文が作成される', ({ after, result }) =>
      result.ok ? after.orders.length > 0 : true,
    ),
    ensure('stock-decremented', '成功時に在庫が減少する', ({ before, after, result }) =>
      result.ok ? after.stock < before.stock : true,
    ),
  ],

  // 不変条件 — 前後で変わらないこと
  invariants: [
    invariant('total-consistent', '注文合計が品目の合計と一致する', ({ after, result }) =>
      result.ok ? after.orderTotal === after.itemsSum : true,
    ),
  ],

  // エラー条件 — 起こりうるエラーとその条件
  errors: [
    errorClause('err-empty', 'empty_cart', 'カートが空'),
    errorClause('err-stock', 'out_of_stock', '在庫切れ',
      ({ input, state }) => state.stock < input.items.length,
    ),
  ],

  // 副作用の検証（observe 関数が必要）
  effects: [
    effect('evt-created', 'emittedEvents', '注文作成イベントが発行される',
      (observed, { result }) =>
        result.ok
          ? (observed.emittedEvents ?? []).some((e: any) => e.type === 'OrderCreated')
          : true,
    ),
  ],

  dependsOn: ['LAW-SortIdempotent'],
});
```

---

## 依存グラフと検証の伝播

Spec は `dependsOn` で他の Spec を参照し、有向非巡回グラフ（DAG）を形成する。

```typescript
import { RefinementGraph, generateObligations, propagateEvidence } from 'seizu/spec';

// グラフを構築
const graph = new RefinementGraph();
graph.addAll([sortLaw, createOrderSpec, requirement]);

// バリデーション（循環参照・未解決参照の検出）
const validation = graph.validate();
if (!validation.ok) {
  console.error(validation.error.issues);
}

// Obligation の生成
const obligations = graph.allSpecs().flatMap(s => generateObligations(s));
// 各 obligation は固定フォーマットの ID を持つ:
//   UC-CreateOrder:given:has-items
//   UC-CreateOrder:ensure:order-created
//   UC-CreateOrder:error:err-stock
//   UC-CreateOrder:smt:consistency
//   LAW-SortIdempotent:law:idempotent
```

### 検証状態の伝播

検証結果は依存グラフを通じて伝播する。5 段階のステータスで管理:

| ステータス | 意味 |
|-----------|------|
| `PROVED`  | SMT で数学的に証明済み |
| `TESTED`  | PBT で実験的に確認済み |
| `REFUTED` | 反例が発見された |
| `UNKNOWN` | 未検証 |
| `ASSUMED` | 人間が手動で受理 |

伝播の優先順位（高い順）:

1. **REFUTED** が 1 つでもあれば → `refuted`
2. **UNKNOWN** があれば → `unknown`
3. 依存先に問題があれば → `invalid`
4. **ASSUMED** があれば → `assumed`
5. 全て PROVED/TESTED → `valid`

```typescript
// 検証結果（PBT + SMT の merge 後）
const results = new Map([
  ['LAW-SortIdempotent', {
    specId: 'LAW-SortIdempotent',
    obligations: [
      { obligationId: 'LAW-SortIdempotent:law:idempotent',       status: 'TESTED' },
      { obligationId: 'LAW-SortIdempotent:law:preserves-length', status: 'TESTED' },
      { obligationId: 'LAW-SortIdempotent:smt:consistency',      status: 'PROVED' },
    ],
  }],
]);

// 伝播
const evidence = propagateEvidence(graph, results);
console.log(evidence.get('LAW-SortIdempotent')?.status);
// → 'valid' （全 obligation が PROVED or TESTED）
```

**依存先が REFUTED なら親も invalid になる:**

```
LAW-Sort: REFUTED（反例あり）
  ↓ 依存
UC-CreateOrder: invalid（依存先に問題）
  ↓ 依存
REQ-Order: invalid（依存先に問題）
```

---

## Assume-Guarantee 検証

seizu の SMT 証明の核心は **Assume-Guarantee** パターン:

1. 副作用を含むモジュールは PBT で `TESTED` にする
2. その Spec の ensures/invariants を「公理」として SMT に投入
3. 上位 Spec の ensures がその公理から論理的に導出可能かを Z3 で証明

```
┌──────────────────────────────────────────────┐
│  LawSpec: updateBalances は合計を保存する       │
│  → PBT: 実装が法則を満たす → TESTED            │
│  → SMT: 法則群が矛盾しない → PROVED            │
└──────────────┬───────────────────────────────┘
               │ dependsOn（公理として使用）
               ▼
┌──────────────────────────────────────────────┐
│  UsecaseSpec: transfer は合計を保存する         │
│  → ASSUME: updateBalances の法則（TESTED 済み） │
│  → PROVE: 公理 + given → ensures が成立するか   │
│  → SMT: Z3 で証明 → PROVED                    │
│  → PBT: 実装が ensures を満たす → TESTED       │
└──────────────────────────────────────────────┘
```

SMT は **Spec の predicate 関数のみ**をエンコードする。実装本体の AST 解析は行わない。

---

## CLI コマンド

### `seizu compile`

仕様ファイルを解析し、依存グラフを構築し、SMT 証明を実行する。

```bash
seizu compile --config seizu.config.ts
```

出力:
- `.seizu/graph.json` — 依存グラフ、Obligation、SMT 結果
- `.seizu/manifest.json` — モジュール解決情報、ダイジェスト

### `seizu verify --specs`

PBT で実装が仕様を満たすか検証する。SMT 結果とマージして最終ステータスを算出。

```bash
seizu verify --specs --config seizu.config.ts
```

出力例:
```
  残高の合計は更新操作で変化しない (LAW-BalanceConservation)
    ✓ law:conserve-total — TESTED
    ? smt:consistency — UNKNOWN
    propagation: unknown

  口座間送金 (UC-Transfer)
    ✓ given:positive-amount — TESTED
    ✓ given:different-accounts — TESTED
    ✓ ensure:balance-preserved — TESTED
    ✓ error:err-same — TESTED
    ✓ error:err-funds — TESTED
    ✓ runtime:no_throw — TESTED
    ? smt:consistency — UNKNOWN
    propagation: unknown

  3 specs, 12 obligations: 0 proved, 8 tested, 0 refuted, 4 unknown
```

### `seizu doc --specs`

依存グラフと検証状態を Markdown で出力する。

```bash
seizu doc --specs --output docs/specs.md
```

Mermaid 依存グラフと Obligation ステータステーブルを含むドキュメントが生成される。

### `seizu migrate legacy`

既存の `define()` / `scenario()` から formal spec の skeleton を生成する。

```bash
seizu migrate legacy --config seizu.config.ts --stdout
```

---

## セルフドッグフーディング

seizu は自身のコアロジックに対して formal spec を定義し、自身を検証している:

| Spec | 検証対象 | 法則 |
|------|---------|------|
| `LAW-GraphTopologicalSort` | トポロジカルソートが依存順序を尊重 | 依存先が依存元より前に出現 |
| `LAW-GraphCycleDetection` | 循環検出の正確性 | 循環→CycleError, 未解決→validation失敗 |
| `LAW-GraphDependencySymmetry` | dependencies/dependants の対称性 | A→B なら B.dependants に A |
| `LAW-PropagationPriority` | 伝播の優先順位 | REFUTED が常に最優先 |
| `LAW-PropagationDepInvalid` | 依存先の REFUTED 伝播 | 親が invalid になる |
| `LAW-ObligationIdFormat` | Obligation ID のフォーマット | `specId:kind:clauseId` |
| `LAW-ObligationCount` | Obligation 数の正確性 | N law + 1 SMT = N+1 |

```bash
cd packages/seizu
pnpm run spec:compile   # 7 specs, 18 obligations, SMT 証明実行
pnpm run spec:verify    # 11 TESTED, 0 REFUTED
pnpm run spec:doc       # Mermaid グラフ + ステータステーブル
```

---

## Obligation ID フォーマット

全ての Obligation は決定的なフォーマットの ID を持つ:

```
${specId}:given:${clauseId}           # 事前条件
${specId}:ensure:${clauseId}          # 事後条件
${specId}:invariant:${clauseId}       # 不変条件
${specId}:error:${clauseId}           # エラー条件
${specId}:law:${clauseId}             # 代数的法則
${specId}:effect:${clauseId}:${facet} # 副作用検証
${specId}:runtime:no_throw            # ランタイム例外なし
${specId}:smt:consistency             # SMT 整合性
${specId}:smt:error_completeness      # SMT エラー完全性
${specId}:smt:refinement:${depSpecId} # SMT 精緻化
```

---

## API リファレンス

### Clause ファクトリ関数

```typescript
import { given, ensure, invariant, errorClause, law, effect } from 'seizu/spec';

// 事前条件
given(id, description, (ctx: { input, state }) => boolean)

// 事後条件
ensure(id, description, (ctx: { before, after, input, result }) => boolean)

// 不変条件
invariant(id, description, (ctx: { before, after, input, result }) => boolean)

// エラー条件
errorClause(id, tag, description, predicate?)

// 代数的法則
law(id, description, (args, result) => boolean)

// 副作用検証
effect(id, facet, description, (observed, ctx) => boolean)
```

### Spec ビルダー

```typescript
import { requirementSpec, usecaseSpec, lawSpec } from 'seizu/spec';

requirementSpec({ id, name, actors, goal, given, success, failure, forbidden, examples, dependsOn })
usecaseSpec({ id, name, target, classifyError, given, ensures, invariants, errors, effects, dependsOn })
lawSpec({ id, name, target, generators, laws, dependsOn })
```

### グラフ操作

```typescript
import { RefinementGraph, generateObligations, propagateEvidence } from 'seizu/spec';

const graph = new RefinementGraph();
graph.add(spec);
graph.addAll(specs);
graph.validate();                    // Result<void, GraphValidationError>
graph.topologicalSort();             // string[] (CycleError on cycle)
graph.dependencies(id);              // string[]
graph.dependants(id);                // string[]
generateObligations(spec);           // ObligationRecord[]
propagateEvidence(graph, results);   // Map<string, PropagatedEvidence>
```
