# seizu システム概要

## 目次

- [1. システムの概要](#1-システムの概要)
- [2. 目指しているポイント](#2-目指しているポイント)
- [3. コアライブラリ（seizu パッケージ）](#3-コアライブラリseizu-パッケージ)
- [4. CLI ツール（seizu-cli パッケージ）](#4-cli-ツールseizu-cli-パッケージ)
- [5. 仕様階層とリファインメントグラフ](#5-仕様階層とリファインメントグラフ)
- [6. 検証戦略](#6-検証戦略)
- [7. エビデンスモデル](#7-エビデンスモデル)
- [8. ドッグフーディング（自己適用）](#8-ドッグフーディング自己適用)
- [9. 実例：銀行送金サービス](#9-実例銀行送金サービス)
- [10. 解決する課題](#10-解決する課題)
- [11. アーキテクチャ構成](#11-アーキテクチャ構成)

---

## 1. システムの概要

**seizu**（星図）は、TypeScript 向けのコントラクトベース状態遷移ライブラリです。正式名称は **State Engine for Invariant-driven Zero-defect Unification** です。

`define()` で `{ pre, transition, post, invariant }` を宣言することで、**実行可能な関数** と **Property-Based Testing（PBT）で検証可能なメタデータ** を一つの定義から同時に得られます。これにより、AI エージェントや開発者が信頼性の高いコードを最小限のレビュー負荷で生成できるようになります。

### 基本的な考え方

> 意図を一度だけ仕様として記述し、人間と機械の両方がその実装の正しさを検証する。

一つの人間が読める **仕様（spec）** がシステムの要件を記述し、決定的なコンパイラがこの仕様を内部表現に変換します。この内部表現は証明、テスト、実行時アサーションの全てに使用されます。

---

## 2. 目指しているポイント

seizu は以下の 7 つの設計原則に基づいています。

| 原則 | 内容 |
|------|------|
| **単一仕様** | 作成する仕様は一つだけ。人間が読める形式で書かれ、曖昧さなく内部 IR にコンパイルされる。「作成用仕様」と「証明用仕様」を別々に管理する二重メンテナンスを排除 |
| **階層的抽象化** | 仕様は複数のレベルに存在：要件、シナリオ、ユースケース、状態機械、法則。各レベルが上位を詳細化する DAG 構造 |
| **プレーン TypeScript** | 実装は標準的な TypeScript で記述。カスタムランタイムフレームワーク不要。仕様は関数に外部から付与 |
| **関心の分離** | 仕様はビジネスロジック、API エンドポイント、ユーザーフローなど意味のある境界のみをカバー |
| **エビデンスと監査可能性** | 各仕様句が義務（obligation）を生成し、PROVED / TESTED / REFUTED / UNKNOWN / ASSUMED のステータスで管理 |
| **隠れたセマンティクスの排除** | 仕様が依存するすべての振る舞い（入力、状態、出力、副作用）は明示的に宣言 |
| **拡張可能な検証** | PBT、状態付きテスト、SMT ソルバー、モデル検査、差分テストなど多様な検証バックエンドに対応 |

---

## 3. コアライブラリ（seizu パッケージ）

ゼロ依存のコアライブラリで、以下の主要コンポーネントを提供します。

### 3.1 コントラクト定義（`define()`）

状態遷移コントラクトを定義する中核 API です。

```typescript
import { define, guard, check, ensure, ok, err, pass } from 'seizu';

const add = define<State, Input, Err>('add', {
  pre: [guard('amount must be positive', (_s, input) =>
    input.amount > 0 ? pass : err('NEGATIVE_RESULT'))],
  transition: (state, input) => ({ count: state.count + input.amount }),
  post: [check('count increases', (before, after) =>
    after.count > before.count ? true : 'count did not increase')],
  invariant: [ensure('count is non-negative', (state) =>
    state.count >= 0 ? true : 'count is negative')],
});
```

**実行時モード：**

| モード | 動作 | 用途 |
|--------|------|------|
| `production`（デフォルト） | 事前条件と遷移のみ実行。高速 | 本番環境 |
| `strict` | 事後条件・不変条件も検査。遷移エラーを `TransitionPanic` でラップ | テスト・開発環境 |

### 3.2 Result 型

判別共用体（discriminated union）による型安全なエラーハンドリングを提供します。

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

`ok()`, `err()`, `map()`, `flatMap()`, `match()`, `mapErr()`, `tryCatch()` 等のユーティリティ関数を含みます。

### 3.3 シナリオ合成（`scenario()`）

複数のコントラクトを逐次ワークフローとして合成します。

```typescript
import { scenario, step } from 'seizu';

const transfer = scenario<Account, TransferInput, BankError>(
  'transfer',
  (input) => [
    step(withdraw, { amount: input.amount }),
    step(deposit, { amount: input.amount }),
  ]
);
```

### 3.4 仕様システム（`seizu/spec`）

5 種類の仕様タイプを構築するためのビルダー、条件句ファクトリ、リファインメントグラフ、義務生成、エビデンス伝搬を提供します。

### 3.5 検証（`seizu/verify`）

Property-Based Testing（PBT）を [fast-check](https://github.com/dubzzz/fast-check) で実行します。

```typescript
import { assertContractValid } from 'seizu/verify';
import fc from 'fast-check';

assertContractValid(add, {
  state: fc.record({ count: fc.nat() }),
  input: fc.record({ amount: fc.integer({ min: 1, max: 100 }) }),
});
```

### 3.6 SMT ソルバー連携（`seizu/smt`）

Z3 SMT ソルバーによる形式検証をオプションで利用可能です。述語を SMT-LIB 形式にエンコードし、数学的証明を提供します。

### 3.7 テストユーティリティ（`seizu/testing`）

```typescript
import { expectOk, expectErr } from 'seizu/testing';
const state = expectOk(result); // err の場合は例外をスロー
```

---

## 4. CLI ツール（seizu-cli パッケージ）

静的解析、ドキュメント生成、PBT 検証のオーケストレーションを提供します。

| コマンド | 説明 |
|----------|------|
| `seizu init` | 新規プロジェクトのスキャフォールド。設定ファイルと Claude Code スキル連携のテンプレートを生成 |
| `seizu compile` | 仕様ファイルを解析し、リファインメントグラフを構築。循環依存の検出とバリデーション |
| `seizu verify` | PBT・SMT・シナリオ検証を実行。複数のレポーター（summary, json, replay）に対応 |
| `seizu doc` | 仕様グラフからドキュメント（Markdown/HTML）を生成。リファインメント図とエビデンス表を含む |
| `seizu coverage` | コントラクトカバレッジメトリクスをレポート |
| `seizu migrate` | レガシー仕様フォーマットからの移行 |

---

## 5. 仕様階層とリファインメントグラフ

seizu は 5 種類の仕様タイプを定義し、各レベルが上位の仕様を段階的に詳細化します。

```
RequirementSpec（要件：高レベル）
  ↓ dependsOn
ScenarioSpec（ユーザーフロー）
  ↓ dependsOn
UsecaseSpec（バックエンド操作）
  ↓ dependsOn
ModelSpec（状態遷移）
  ↓ dependsOn
LawSpec（純粋関数の性質）
```

### 5.1 RequirementSpec

人間が読める高レベルの要件を記述します。アクター、目標、成功・失敗条件、禁止事項を含みます。

### 5.2 ScenarioSpec

ユーザーの具体的な操作フローを定義します。ステップの列と期待される結果を記述し、エンドツーエンドテストに使用します。

### 5.3 UsecaseSpec

原子的なバックエンド操作（HTTP エンドポイント、RPC、ドメインコマンド）を記述します。事前条件（given）、事後条件（ensures）、不変条件（invariants）、副作用（effects）、エラー（errors）を定義します。

### 5.4 ModelSpec

アプリケーション内の状態遷移（リデューサー、有限状態機械）をモデル化します。コマンドの列をランダムに生成し、不変条件を検証します。

### 5.5 LawSpec

純粋関数の代数的性質（可換性、結合律、単調性など）を PBT で検証します。

### リファインメントグラフ

仕様間の依存関係は有向非巡回グラフ（DAG）を形成します。コンパイル時に：

1. グラフの循環がないことを検証
2. 各仕様の述語と副作用を原子的な **義務（obligation）** に展開
3. 義務のステータスをグラフ全体に伝搬

---

## 6. 検証戦略

異なる種類の性質には異なる証明技法が必要です。seizu は以下の検証バックエンドをサポートします。

| 戦略 | 対象 | 説明 |
|------|------|------|
| **Property-Based Testing（PBT）** | LawSpec, UsecaseSpec | fast-check によるランダム入力生成で性質を検証 |
| **Stateful PBT / モデル探索** | ModelSpec | コマンド列をランダム生成し、不変条件を検証 |
| **決定的シナリオスイート** | ScenarioSpec | 既知の入出力によるエンドツーエンドテスト |
| **履歴ベースチェッカー** | 弱整合性システム | 観測されたイベント履歴が正しい順序実行から生じ得るかを検証 |
| **SMT ソルバー / 形式証明** | 算術・論理条件 | Z3 による量化子や無限定義域を含む義務の排出 |
| **差分テスト** | 複数実装の比較 | 実装間の不一致からバグを検出 |
| **実行時アサーション・監視** | 実行時不変条件 | テレメトリチェックと SLO バジェットの生成 |

---

## 7. エビデンスモデル

各義務には以下のステータスが付与されます。

| ステータス | 意味 |
|------------|------|
| **PROVED** | SMT やモデル検査により形式的に証明済み |
| **TESTED** | PBT やテストにより経験的に検証済み（形式証明ではない） |
| **REFUTED** | 反例が発見された（仕様またはコードの違反） |
| **UNKNOWN** | エビデンスなし（検証未実行またはタイムアウト） |
| **ASSUMED** | 人間のレビュアーが証明なしで承認（公理や未解決の義務に限定使用） |

ステータスは仕様グラフ全体に伝搬します。上位仕様は、その全義務が PROVED または TESTED であり、かつ全依存先が有効な場合にのみ **valid** と判定されます。

---

## 8. ドッグフーディング（自己適用）

seizu は自身の仕様フレームワークを使って自己の正しさを形式化しています。

- **コアライブラリ**（`packages/seizu/src/spec/seizu.spec.ts`）：リファインメントグラフのトポロジカルソート、循環検出、依存対称性、エビデンス伝搬を `LawSpec` で仕様化
- **CLI**（`packages/seizu-cli/seizu.config.ts`）：ドメインロジック（パイプライン、レンダリング、レポート生成）のコントラクトを自身のフレームワークで管理

---

## 9. 実例：銀行送金サービス

`packages/example/` に含まれる実用例です。

| レイヤー | 内容 |
|----------|------|
| **ドメイン**（`domain/`） | 口座の入出金、送金の検証と状態適用 |
| **API**（`api/`） | Hono による HTTP エンドポイント |
| **インフラ**（`infra/`） | SQLite データベース、リポジトリ |
| **仕様**（`spec/`） | ドメイン法則（debit preservation, credit success, transfer conservation）、API 要件、HTTP ルート仕様 |

仕様として以下を定義：
- **LawSpec**：「出金は残高を保存する」「入金は常に成功する」「送金は総残高を保存する」
- **RequirementSpec**：API サービスの要件
- **UsecaseSpec**：HTTP ルートの振る舞い

---

## 10. 解決する課題

| 課題 | seizu による解決策 |
|------|-------------------|
| AI 生成コードのレビューが困難 | 仕様がレビュー可能なコントラクトとして機能。レビュアーは実装ではなく意図を確認 |
| テストは例示であり証明ではない | PBT + SMT により無限の入力空間に対する数学的保証を提供 |
| 仕様とテストの二重メンテナンス | 単一の仕様からランタイム、テスト、証明の全形式を自動生成 |
| 隠れた副作用 | 仕様で全ての観測可能な副作用（DB変更、イベント、レスポンス）の明示的宣言を要求 |
| 仕様とコードの乖離 | 仕様を CI ファーストのアーティファクトとしてコードと共にバージョン管理 |
| 異なる性質に異なる検証が必要 | 階層化された仕様にプラガブルな検証バックエンドを対応付け |

---

## 11. アーキテクチャ構成

### パッケージ構成

```
seizu/
├── packages/
│   ├── seizu/            ← コアライブラリ（ゼロ依存）
│   │   └── src/
│   │       ├── define.ts       # コントラクト定義 API
│   │       ├── result.ts       # Result<T,E> 型とユーティリティ
│   │       ├── scenario.ts     # シナリオ合成
│   │       ├── spec/           # 仕様システム（ビルダー、グラフ、義務、伝搬）
│   │       ├── verify/         # PBT 検証エンジン
│   │       └── smt/            # SMT ソルバー連携
│   ├── seizu-cli/        ← CLI ツール
│   │   └── src/
│   │       ├── commands/       # init, compile, verify, doc, coverage, migrate
│   │       ├── doc/            # ドキュメント生成（AST 解析、レンダラー、i18n）
│   │       ├── verify/         # 検証パイプラインとレポーター
│   │       └── config/         # 設定ローダー
│   ├── example/          ← 銀行送金サービスの実例
│   └── docs/             ← Astro ベースのドキュメントサイト
├── SPEC.md               ← 技術設計仕様書
└── package.json          ← pnpm モノレポ（Turbo ビルド）
```

### サブエクスポート一覧

| エクスポート | 内容 |
|-------------|------|
| `seizu` | `define()`, `scenario()`, `step()`, Result ユーティリティ, `setContractMode()` |
| `seizu/testing` | `expectOk()`, `expectErr()` テストアサーション |
| `seizu/verify` | `assertContractValid()`, `verify()`, `verifyLaw()`, `verifyUsecase()` |
| `seizu/spec` | 仕様ビルダー、条件句ファクトリ、グラフ、義務生成、伝搬 |
| `seizu/smt` | `proveGraph()`, SMT ソルバー統合（オプション、z3-solver ピア依存） |
| `seizu-cli` | CLI コマンド群と設定型定義 |

### 開発環境

- **言語**: TypeScript（Node.js >= 20）
- **パッケージマネージャ**: pnpm >= 10（モノレポ管理）
- **ビルド**: tsup + Turbo
- **テスト**: Vitest（カバレッジ 80% 以上必須）
- **リンター/フォーマッタ**: Biome
- **コミット規約**: Conventional Commits
