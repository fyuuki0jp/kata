// Spec types

// Base
export { ObligationStatus } from './spec/base';
// Builders
export { lawSpec, requirementSpec, usecaseSpec } from './spec/builders';
// Clauses
export type {
  EffectClause,
  EffectFacet,
  EnsureClause,
  ErrorClause,
  GivenClause,
  GivenContext,
  InvariantClause,
  LawClause,
  ObservedEffects,
  SpecRef,
  TransitionContext,
} from './spec/clauses';
export {
  effect,
  ensure,
  errorClause,
  given,
  invariant,
  law,
} from './spec/clauses';
// Graph
export {
  CycleError,
  GraphValidationError,
  RefinementGraph,
} from './spec/graph';
// Obligations
export type { ObligationRecord } from './spec/obligations';
export { generateObligations } from './spec/obligations';
// Propagation
export type {
  ObligationResult,
  PropagatedEvidence,
  PropagationStatus,
  SpecVerifyResult,
} from './spec/propagation';
export { propagateEvidence } from './spec/propagation';
export type {
  AnySpec,
  LawSpec,
  RequirementSpec,
  SpecKind,
  TargetLocator,
  UsecaseSpec,
} from './spec/specs';
