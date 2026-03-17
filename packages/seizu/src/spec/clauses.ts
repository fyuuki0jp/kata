import type { Result } from '../result';

export type SpecDependencyMode = 'axiom' | 'trace';

export interface SpecDependency {
  readonly id: string;
  readonly mode?: SpecDependencyMode;
}

// SpecRef = plain string or structured dependency reference
export type SpecRef = string | SpecDependency;

export function specRefId(ref: SpecRef): string {
  return typeof ref === 'string' ? ref : ref.id;
}

export function specRefMode(ref: SpecRef): SpecDependencyMode {
  return typeof ref === 'string' ? 'axiom' : (ref.mode ?? 'axiom');
}

// コンテキスト型
export interface GivenContext<I, S> {
  readonly input: I;
  readonly state: S;
}

export interface TransitionContext<I, O, E, S> {
  readonly before: S;
  readonly after: S;
  readonly input: I;
  readonly result: Result<O, E>;
}

// Clause型 — 全てにid必須
export interface GivenClause<I = unknown, S = unknown> {
  readonly id: string;
  readonly description: string;
  readonly predicate: (ctx: GivenContext<I, S>) => boolean;
}

export interface EnsureClause<
  I = unknown,
  O = unknown,
  E = unknown,
  S = unknown,
> {
  readonly id: string;
  readonly description: string;
  readonly predicate: (ctx: TransitionContext<I, O, E, S>) => boolean;
}

export interface InvariantClause<
  I = unknown,
  O = unknown,
  E = unknown,
  S = unknown,
> {
  readonly id: string;
  readonly description: string;
  readonly predicate: (ctx: TransitionContext<I, O, E, S>) => boolean;
}

export interface ErrorClause<I = unknown, E = unknown, S = unknown> {
  readonly id: string;
  readonly tag: string; // spec内で一意必須
  readonly description: string;
  readonly predicate?: (ctx: { input: I; error: E; state: S }) => boolean;
}

export interface LawClause<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  R = unknown,
> {
  readonly id: string;
  readonly description: string;
  readonly predicate: (args: TArgs, result: R) => boolean;
}

export type EffectFacet =
  | 'dbDiff'
  | 'emittedEvents'
  | 'response'
  | 'sideEffects';

export interface EffectClause<
  I = unknown,
  O = unknown,
  E = unknown,
  S = unknown,
> {
  readonly id: string;
  readonly facet: EffectFacet;
  readonly description: string;
  readonly predicate: (
    observed: ObservedEffects,
    ctx: TransitionContext<I, O, E, S>
  ) => boolean;
}

export interface ObservedEffects {
  readonly dbDiff?: unknown;
  readonly emittedEvents?: readonly unknown[];
  readonly response?: unknown;
  readonly sideEffects?: readonly unknown[];
}

// ファクトリ関数
export function given<I, S>(
  id: string,
  description: string,
  predicate: (ctx: GivenContext<I, S>) => boolean
): GivenClause<I, S> {
  return { id, description, predicate };
}

export function ensure<I, O, E, S>(
  id: string,
  description: string,
  predicate: (ctx: TransitionContext<I, O, E, S>) => boolean
): EnsureClause<I, O, E, S> {
  return { id, description, predicate };
}

export function invariant<I, O, E, S>(
  id: string,
  description: string,
  predicate: (ctx: TransitionContext<I, O, E, S>) => boolean
): InvariantClause<I, O, E, S> {
  return { id, description, predicate };
}

export function errorClause<I, E, S>(
  id: string,
  tag: string,
  description: string,
  predicate?: (ctx: { input: I; error: E; state: S }) => boolean
): ErrorClause<I, E, S> {
  return { id, tag, description, predicate };
}

export function law<TArgs extends Record<string, unknown>, R>(
  id: string,
  description: string,
  predicate: (args: TArgs, result: R) => boolean
): LawClause<TArgs, R> {
  return { id, description, predicate };
}

export function effect<I, O, E, S>(
  id: string,
  facet: EffectFacet,
  description: string,
  predicate: (
    observed: ObservedEffects,
    ctx: TransitionContext<I, O, E, S>
  ) => boolean
): EffectClause<I, O, E, S> {
  return { id, facet, description, predicate };
}
