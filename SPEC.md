# seizu Formal Specification and Verification Library – Technical Design

## 1 Introduction and goals

Modern software teams increasingly rely on AI agents to produce large amounts of code.  This trend exacerbates the long‑standing problem of reasoning about system behaviour without reading every line of implementation.  Unit tests provide examples but cannot exhaustively cover the infinite input space; formal verification promises proofs that certain properties always hold【143936214820735†L75-L87】.  The **seizu** project aims to make this level of assurance feasible for everyday TypeScript applications.

The goal of seizu is to let a team specify their intent once, then have both humans and machines verify that implementations adhere to it.  A single human‑readable **spec** describes the requirements, while a deterministic compiler lowers this spec to an internal representation used for proof, testing and runtime assertions.  By doing this we hope to:

* reduce the amount of implementation code that a reviewer must read—the reviewer checks the spec instead;
* keep code in plain TypeScript, avoiding invasive frameworks; and
* support a range of verification strategies—from property‑based tests to SMT solvers and model checkers—to suit different properties.

This document defines the **SPEC.md** file format and the accompanying TypeScript API.  Reading it should enable an engineer to implement seizu core or to write new specs and integrate them into a CI pipeline.

## 2 Background and motivation

### 2.1 Specifications and their hierarchy

Specifications come in different forms.  The ElectricSQL “Configurancy” article stresses that a good specification stack has four layers【956177824053304†L326-L346】:

1. **External oracle** – a ground‑truth reference outside your system (e.g. a protocol RFC or another database).
2. **Reference model** – an executable model that encodes the oracle’s behaviour.
3. **Conformance suite** – the operationalised contract that implementations must pass.
4. **Prose rationale** – an explanation of why the contract exists, the trade‑offs and history behind it.

Drift between these layers is a first‑class failure mode: a test that no longer reflects the oracle or an outdated rationale will mislead both humans and AI【956177824053304†L343-L346】.  Seizu therefore treats the spec as a first‑class artefact, subject to version control and CI checks.

### 2.2 Design by contract

A long‑standing technique for specifying and checking correctness is **design by contract**.  In its simplest form, a function has:

* **preconditions** (what must hold before it is called);
* **postconditions** (what must hold on successful return); and
* **invariants** (properties that remain true across calls).

Languages and libraries that support contracts allow compile‑time checking or runtime assertions【564729216256928†L111-L124】.  Seizu builds on these ideas by making pre/post/invariant clauses explicit in `UsecaseSpec` definitions.

### 2.3 Refinement types

Refinement types attach predicates to base types.  Refined TypeScript (RSC) extends TS with a light‑weight refinement system that can statically verify properties such as safe array access and downcasts【629448502503364†L7-L24】.  While seizu does not require a dedicated type checker, these ideas inform the design of predicates: they must be total, side‑effect‑free, and refer only to parameters and state.

### 2.4 Property‑based and stateful testing

Property‑based testing (PBT) randomly generates inputs to check that a property holds for all cases【936927113193513†L31-L36】.  For stateful systems, sequences of operations are generated to explore many execution paths and check invariants【936927113193513†L120-L130】.  ElectricSQL notes that different problems need different test suites: deterministic scenario suites for crisp invariants, fuzzers for large input spaces, history‑based checkers for weak consistency, model checking for concurrency, and differential tests when multiple implementations exist【956177824053304†L350-L370】.  Seizu embraces this diversity by associating each spec layer with suitable verification backends.

### 2.5 Need for formal verification

Formal verification constructs proofs that properties always hold.  A proof provides stronger assurance than tests: tests are experiments; proofs are mathematical guarantees【143936214820735†L75-L87】.  As AI code generation proliferates, the cost of generating code drops while the cost of manually reviewing it does not, motivating automated proof and specification tools【143936214820735†L90-L109】.

## 3 Key design principles

The following principles guide seizu’s architecture:

1. **Single spec** – There is only one authoring spec.  It is human‑readable and unambiguously compiled into an internal IR.  We do **not** maintain separate “authoring” and “proving” specs; the latter is automatically derived.  This avoids dual maintenance and ensures that reviewing the spec alone is sufficient to understand the system.
2. **Layered abstraction** – Specs exist at multiple levels: high‑level requirements, user scenarios, backend use cases, state machines, and individual laws.  Each level refines the one above.  The spec graph is a directed acyclic graph (DAG) rather than a tree—lower‑level specs may be shared by multiple higher‑level ones.
3. **Plain TypeScript** – Implementations are written in standard TypeScript without custom runtime frameworks.  Specs attach externally to functions via API calls; they do not require altering function bodies.  This preserves interoperability and allows AI agents to generate ordinary code.
4. **Separation of concerns** – Specs cover only meaningful boundaries (business logic, API endpoints, user flows).  Generic helper functions remain internal unless they embody a domain law.
5. **Evidence and auditability** – Each specification clause generates obligations with statuses (`PROVED`, `TESTED`, `REFUTED`, `UNKNOWN`, `ASSUMED`).  Evidence is collected and summarised.  Reviewers focus on unproven or assumed obligations.
6. **No hidden semantics** – All behaviour on which a spec depends (inputs, state, outputs, side effects) must be explicitly declared.  Hidden side effects are disallowed.
7. **Extensible verification** – Different spec layers use appropriate verification techniques: PBT, stateful tests, SMT solving, model checking, differential testing.  Additional backends can be integrated without changing spec syntax.

## 4 Specification hierarchy

Seizu defines five major spec types.  Each has a dedicated constructor function and a TypeScript interface.  Specs may reference other specs through the `dependsOn` field, forming a refinement graph.  Names and IDs should follow your project’s ubiquitous language to make specs self‑descriptive.

### 4.1 `RequirementSpec`

Captures high‑level, human‑readable requirements.  It is written in a half‑structured format that non‑engineers can review.  Fields include:

| Field | Type | Purpose |
|---|---|---|
| `id` | string | Unique identifier (e.g. `REQ‑OrderPurchase`) |
| `name` | string | Short description |
| `actors` | string[] | Roles involved (e.g. `buyer`, `admin`) |
| `goal` | string | What the actor wants to achieve |
| `given` | string[] | Preconditions or assumptions |
| `success` | string[] | Conditions that must hold if the goal succeeds |
| `failure` | string[] | Conditions that must hold on failure |
| `forbidden` | string[] | Behaviours that must never occur |
| `examples` | string[] | Positive and negative scenarios illustrated informally |

These are descriptive sentences.  During compilation, the compiler will prompt for clarification if a clause is ambiguous.  For example, “stock is sufficient” must be elaborated into a predicate in a lower‑level spec.

### 4.2 `ScenarioSpec`

Represents a specific user interaction or flow refined from one or more RequirementSpecs.  It specifies the sequence of steps that a user takes and the expected outcomes.  Fields include:

| Field | Type | Purpose |
|---|---|---|
| `id` | string | Unique identifier |
| `name` | string | Summary of scenario |
| `description` | string | Detailed description |
| `actors` | string[] | Roles participating |
| `steps` | array of `ScenarioStep` | Each step names an action (e.g. call use case, click button) and optional input |
| `expects` | array of `ScenarioExpectation` | Assertions on the final observable state (e.g. order appears in history) |
| `dependsOn` | Spec[] | Lower‑level specs used (UsecaseSpec or ModelSpec) |

`ScenarioStep` is a discriminated union describing either a backend call or a UI event.  `ScenarioExpectation` defines expected state properties or UI predicates.  Scenario specs are used for end‑to‑end tests and may leverage stateful property‑based testing or history‑based checkers for eventual consistency【956177824053304†L361-L364】.

### 4.3 `UsecaseSpec`

Describes an atomic backend operation (HTTP endpoint, RPC call, domain command or job).  It attaches to a target function of signature `(deps: Deps, input: I) => Promise<Result<O, E>>`.  Fields:

| Field | Type | Purpose |
|---|---|---|
| `id` | string | Unique identifier |
| `name` | string | Short description |
| `target` | function reference | The implementation to which this spec applies |
| `given` | array of `GivenClause` | Preconditions that must hold before the function is invoked |
| `ensures` | array of `EnsureClause` | Postconditions that must hold on success |
| `invariants` | array of `InvariantClause` | Properties preserved across call (state invariants) |
| `effects` | `EffectSpec` | Observable effects: DB changes, emitted events, response body, side effects |
| `errors` | array of `ErrorClause` | Allowed error variants and associated conditions |
| `dependsOn` | Spec[] | Lower‑level specs (ModelSpec, LawSpec) |

`GivenClause` is defined as `{ id: string; description: string; predicate: (ctx) => boolean }`.  The predicate receives `{ input, state, actor, deps }` and must be pure.  `EnsureClause` and `InvariantClause` receive `{ before, after, input, result }`.  `ErrorClause` defines an error tag, description, and an optional predicate describing when that error should be returned.

`EffectSpec` may declare:

* `dbDiff`: a function comparing before/after state and returning a diff object;
* `emittedEvents`: a function producing an array of events on success;
* `response`: a function producing a shape of the HTTP or RPC response;
* `sideEffects`: other observed effects (e.g. emails, logs).  Side effects must be enumerated to avoid hidden semantics.

### 4.4 `ModelSpec`

Models state transitions within the application or UI.  This spec is suited to reducers, finite state machines or orchestrations.  Fields:

| Field | Type | Purpose |
|---|---|---|
| `id` | string | Unique identifier |
| `name` | string | Description |
| `target` | function reference | Reducer `(state, action) => state` or similar |
| `initial` | generator function | Produces random initial states for PBT |
| `commands` | array of `ModelCommand` | Possible operations (each with generator and apply function) |
| `invariants` | array of `InvariantClause` | Properties that must hold after any sequence of commands |
| `transitions` | array of `TransitionSpec` | Allowed from→to tag transitions (optional) |
| `dependsOn` | Spec[] | Lower‑level specs (LawSpec) |

`ModelCommand` defines how to generate a command, apply it to state and optionally compute a return value.  Stateful PBT uses these to explore random sequences of operations and check that invariants hold【936927113193513†L120-L130】.

### 4.5 `LawSpec`

Captures algebraic or pure function properties.  It attaches to a pure function `f(...): R` and declares laws that should always hold.  Fields:

| Field | Type | Purpose |
|---|---|---|
| `id` | string | Unique identifier |
| `name` | string | Description |
| `target` | function reference | Pure function being specified |
| `generators` | object | Generators for each parameter; used by PBT |
| `laws` | array of `LawClause` | Predicates `(ctx) => boolean` receiving arguments and result |
| `dependsOn` | Spec[] | Lower‑level specs (other LawSpecs) |

Laws might assert commutativity, associativity, monotonicity or domain‑specific relationships.  They are verified with property‑based testing: many random inputs are generated and the law predicate must hold in all cases【936927113193513†L31-L36】.  If property‑based testing is insufficient (e.g. numeric overflow), law clauses may be discharged via SMT solvers or proofs.

## 5 Predicates and helpers

Predicates are ordinary TypeScript functions used in `given`, `ensures`, `invariants`, etc.  They must be:

1. **Total** – defined for all possible inputs; avoid throwing exceptions.
2. **Side‑effect free** – do not mutate external state or rely on random values.
3. **Pure** – deterministic; same inputs produce same outputs.

Predicates may use helper functions to reduce duplication.  If a helper embodies a domain law (e.g. sum of amounts is non‑negative), it should have its own `LawSpec`; otherwise it is internal and not specified.

## 6 Refinement graph and obligation generation

Specs are linked via `dependsOn`.  Seizu constructs a directed acyclic graph where edges point from a spec to the specs it relies on.  During compilation:

1. Validate that the graph has no cycles.
2. For each spec, expand all predicates and effects into atomic **obligations**.  An obligation is a predicate to prove or test, such as “if `amount > 0` and `from != to` then `totalBalance` is preserved”.
3. Propagate obligation statuses up the graph: a spec is **valid** only if all its obligations are proved or tested and all its dependencies are valid.  If any dependency is unknown or refuted, the parent is considered unverified.

### Composition rules

By default, seizu uses simple composition: a `ScenarioSpec` is valid if all its `UsecaseSpec` and `ModelSpec` dependencies are valid and all `expects` clauses hold in every tested trace.  A `UsecaseSpec` is valid if all its `given` preconditions are enforced in code, all its `ensures` and `invariants` hold for every tested state and input, and only allowed errors occur.  Advanced users may supply custom composition functions when simple conjunction is insufficient.

## 7 Verification strategies

Different kinds of properties require different proof techniques.  Seizu’s CLI orchestrates these backends:

1. **Property‑based testing (PBT)**: For `LawSpec` and `UsecaseSpec` conditions that can be checked with random inputs.  Fast‑check or a similar library generates many samples and shrinks counterexamples.  PBT is good for large combinatorial spaces【956177824053304†L350-L363】.
2. **Stateful PBT / Model exploration**: For `ModelSpec` invariants and transitions.  Random sequences of commands are generated【936927113193513†L120-L130】.  Bounded state exploration ensures invariants hold across many paths; for concurrency or complex interleavings, integration with model checkers (TLA+) is possible【956177824053304†L366-L367】.
3. **Deterministic scenario suites**: For crisp APIs with known inputs/outputs.  These correspond to end‑to‑end tests or integration tests; they are deterministic and check exactly what response a given request should produce【956177824053304†L355-L359】.
4. **History‑based checkers**: For weakly consistent systems.  They verify that observed event histories could come from some sequential execution【956177824053304†L361-L364】.
5. **SMT solving / formal proof**: For arithmetic or logical conditions where exhaustive PBT is insufficient.  Tools like Z3 can discharge obligations that involve quantifiers or infinite domains.
6. **Differential testing**: When multiple implementations exist (e.g. different languages or protocols), discrepancies indicate a specification or implementation bug【956177824053304†L369-L371】.
7. **Runtime assertions and monitoring**: Some invariants (e.g. “offsets never go backwards”) can only be observed at runtime.  Seizu can generate telemetry checks and SLO budgets【956177824053304†L387-L393】.

The verification engine selects backends automatically based on the spec type and clause.  For example, `LawSpec` clauses default to PBT, `UsecaseSpec` invariants may be tested with PBT and proven with SMT, and `ModelSpec` invariants require stateful testing.  Users can override defaults via configuration.

## 8 Evidence model

Each obligation receives a status:

* **PROVED** – The obligation has been formally proven correct (e.g. via SMT or model checking).
* **TESTED** – The obligation has been empirically validated with high‑coverage PBT or deterministic tests, but not formally proved.
* **REFUTED** – A counterexample was found; either the spec is wrong or the code violates it.
* **UNKNOWN** – No evidence yet; verification has not been run or timed out.
* **ASSUMED** – Manually marked as accepted by human reviewers without proof; used sparingly for axioms or unsolved obligations.

Seizu propagates these statuses through the spec graph.  Higher‑level specs are marked as **valid** only when all their obligations are either PROVED or TESTED and all dependencies are valid.  Reports summarise the status of each spec and highlight ASSUMED or UNKNOWN clauses for human review.

## 9 Implementation guidelines

Seizu does not impose a runtime framework; instead, it encourages a disciplined way of writing TypeScript so that specs map cleanly to code.  The following guidelines help maximise verifiability:

1. **Use Result types** – Functions that may fail return `Promise<Result<Ok, Err>>`.  Errors are discriminated unions of tagged variants.  This makes error cases explicit and specifiable.
2. **Inject dependencies** – Pass external services (DB repositories, HTTP clients, clocks) via a `deps` parameter.  Avoid direct imports of global singletons; dependencies are easier to mock and inspect.
3. **Expose observable effects** – Database writes, emitted events, HTTP responses and side effects must be declared in `effects`.  Hidden side effects (e.g. logging, environment variables) should be eliminated or declared.
4. **Pure predicates** – All spec predicates must be pure.  They may access `input`, `state`, `before`, `after`, `result`, but cannot mutate or call asynchronous code.
5. **Small cohesive functions** – Break large operations into smaller functions with clear responsibilities.  Each can then have its own `UsecaseSpec`.
6. **Domain modelling** – Use discriminated unions to model domain states (e.g. `OrderStatus = 'Draft' | 'Submitted' | 'Paid'`).  Reducers handling such unions are good candidates for `ModelSpec`.
7. **Frontend** – Model UI state via a view‑model or reducer and specify it with `ModelSpec` and `ScenarioSpec`.  Predicates should talk about the view model rather than raw DOM.  Observing actual DOM effects belongs to integration testing.

## 10 CLI and tooling

The seizu CLI coordinates compilation, verification and documentation.  Example commands:

| Command | Description |
|---|---|
| `seizu init` | Create a default spec directory and configuration. |
| `seizu compile` | Parse all spec files, construct the refinement graph, normalise predicates, and report any ambiguity or missing fields. |
| `seizu verify` | Generate obligations, run appropriate verification backends (PBT, model exploration, SMT, etc.), collect evidence and emit a report. |
| `seizu doc` | Produce human‑readable documentation (Markdown or HTML) from the spec graph.  Includes diagrams of the refinement graph and evidence tables. |
| `seizu trace` | Query the spec graph to answer behaviour questions (the “30‑day test”【956177824053304†L418-L430】).  Agents can use this to predict system behaviour without reading code. |

The CLI is extensible.  Additional verification backends (e.g. integration with TLA+, Lean or Coq) can be registered without modifying spec syntax.

## 11 End‑to‑end example

Below is a simplified example demonstrating how to write a use case and its spec.  The use case transfers funds between two accounts.

```ts
// Domain types
type TransferInput = { from: string; to: string; amount: number }
type TransferOutput = { transactionId: string }
type TransferError = { type: 'insufficient_funds' } | { type: 'same_account' }
type Result<O, E> = { ok: true; value: O } | { ok: false; error: E }

// Implementation written in plain TS
export async function transferFunds(deps: Deps, input: TransferInput): Promise<Result<TransferOutput, TransferError>> {
  const fromAcc = await deps.accountRepo.find(input.from)
  const toAcc   = await deps.accountRepo.find(input.to)
  if (input.from === input.to) return { ok: false, error: { type: 'same_account' } }
  if (!fromAcc || !toAcc)       return { ok: false, error: { type: 'insufficient_funds' } }
  if (fromAcc.balance < input.amount) return { ok: false, error: { type: 'insufficient_funds' } }
  const txId = await deps.paymentGateway.transfer(input.from, input.to, input.amount)
  await deps.accountRepo.updateBalances(input.from, input.to, input.amount)
  await deps.outbox.publish({ type: 'TransferCompleted', from: input.from, to: input.to, amount: input.amount, txId })
  return { ok: true, value: { transactionId: txId } }
}

// Specification
export const transferFundsSpec = usecaseSpec(transferFunds, {
  id: 'UC-TransferFunds',
  name: 'Transfer money between accounts',
  given: [
    given('amount is positive', ({ input }) => input.amount > 0),
    given('source and destination differ', ({ input }) => input.from !== input.to),
  ],
  ensures: [
    ensure('balance conservation', ({ before, after, input, result }) =>
      result.ok ?
        before.totalBalance === after.totalBalance :
        true
    ),
    ensure('transaction recorded on success', ({ after, result }) =>
      result.ok ? after.transactions.has(result.value.transactionId) : true
    ),
  ],
  invariants: [],
  errors: [
    error('same_account', ({ input }) => input.from === input.to),
    error('insufficient_funds', ({ before, input }) => before.accounts.get(input.from)!.balance < input.amount),
  ],
  effects: {
    dbDiff: ({ before, after, result }) => {
      // compute diff in account balances
      return { balances: after.balances.difference(before.balances) }
    },
    emittedEvents: ({ result, input }) => result.ok ? [ { type: 'TransferCompleted', from: input.from, to: input.to } ] : [],
    response: ({ result }) => result
  },
  dependsOn: [],
})

// Lower‑level law specifying that total balance is conserved by updateBalances
export const updateBalancesLaw = lawSpec(updateBalances, {
  id: 'LAW-UpdateBalances',
  name: 'Updating balances preserves total',
  generators: {
    from: gen.accountId(),
    to: gen.accountId(),
    amount: gen.positiveNumber(),
    state: gen.accountState(),
  },
  laws: [
    law('conserve total', ({ from, to, amount, state }) => {
      const beforeTotal = state.totalBalance
      const afterState = updateBalances(state, { from, to, amount })
      return afterState.totalBalance === beforeTotal
    }),
  ],
})

// The use case spec depends on the law
transferFundsSpec.dependsOn.push(updateBalancesLaw)
```

Running `seizu compile && seizu verify` will parse the spec, generate obligations for each given/ensure/error clause and law, run PBT on `updateBalancesLaw` and property‑based and deterministic tests on the use case.  Any counterexample will mark the relevant clause as REFUTED.  If all clauses are PROVED or TESTED, the spec is marked valid.

## 12 Limitations and future work

Formal specification and verification are powerful but have boundaries:

* **Not everything is specifiable.**  Emerging behaviours (e.g. those produced by ML models) or performance tuning cannot be captured cleanly【956177824053304†L464-L482】.  In such cases, rely on observation and monitoring rather than formal contracts.
* **Upfront cost.**  Writing specs and designing conformance suites require effort【956177824053304†L461-L467】.  For throwaway prototypes, this overhead may not be worth it.
* **Cultural change.**  Teams must treat spec updates as first‑class changes【956177824053304†L475-L476】.  Failing to synchronise spec and code leads to dangerous drift【956177824053304†L396-L406】.
* **Concurrency and distribution.**  State exploration may need integration with model checkers (TLA+)【956177824053304†L366-L367】; initial versions of seizu may not support full distributed verification.
* **Refinement types overhead.**  While RSC shows that refinement types enable static verification of TS code【629448502503364†L7-L24】, adding such annotations can be verbose and may not automatically prove complex properties【564729216256928†L310-L344】.
* **Evidence vs. proof.**  PBT provides strong evidence but not a proof.  Certain properties may require formal reasoning.

Despite these limitations, seizu’s layered specifications and automated verification pipeline offer a practical path towards trustworthy AI‑assisted codebases.  By investing in clear specs and conformance suites early, teams can enable AI to generate and modify code safely while humans focus on high‑level correctness and evolution.