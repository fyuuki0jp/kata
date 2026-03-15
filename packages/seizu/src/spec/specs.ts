import type {
  EffectClause,
  EnsureClause,
  ErrorClause,
  GivenClause,
  InvariantClause,
  LawClause,
  SpecRef,
} from './clauses';

export type SpecKind = 'requirement' | 'usecase' | 'law' | 'model' | 'scenario';

export interface TargetLocator {
  readonly module: string;
  readonly export: string;
}

export interface RequirementSpec {
  readonly kind: 'requirement';
  readonly id: string;
  readonly name: string;
  readonly actors: readonly string[];
  readonly goal: string;
  readonly given: readonly { id: string; text: string }[];
  readonly success: readonly { id: string; text: string }[];
  readonly failure: readonly { id: string; text: string }[];
  readonly forbidden: readonly { id: string; text: string }[];
  readonly examples: readonly string[];
  readonly dependsOn: readonly SpecRef[];
}

export interface UsecaseSpec<
  I = unknown,
  O = unknown,
  E = unknown,
  S = unknown,
> {
  readonly kind: 'usecase';
  readonly id: string;
  readonly name: string;
  readonly target: TargetLocator;
  readonly classifyError: (error: E) => string;
  readonly given: readonly GivenClause<I, S>[];
  readonly ensures: readonly EnsureClause<I, O, E, S>[];
  readonly invariants: readonly InvariantClause<I, O, E, S>[];
  readonly errors: readonly ErrorClause<I, E, S>[];
  readonly effects: readonly EffectClause<I, O, E, S>[];
  readonly dependsOn: readonly SpecRef[];
}

export interface LawSpec<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  R = unknown,
> {
  readonly kind: 'law';
  readonly id: string;
  readonly name: string;
  readonly target: TargetLocator;
  readonly generators: { [K in keyof TArgs]: unknown }; // fc.Arbitrary at runtime
  readonly laws: readonly LawClause<TArgs, R>[];
  readonly dependsOn: readonly SpecRef[];
}

export type AnySpec = RequirementSpec | UsecaseSpec | LawSpec;
