export type {
  BaseSpec,
  Obligation,
  SpecId,
  SpecMetadata,
} from './base';
export { ObligationStatus, specId } from './base';
export { lawSpec, requirementSpec, usecaseSpec } from './builders';
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
  SpecDependency,
  SpecDependencyMode,
  SpecRef,
  TransitionContext,
} from './clauses';
export {
  effect,
  ensure,
  errorClause,
  given,
  invariant,
  law,
  specRefId,
  specRefMode,
} from './clauses';
export { CycleError, GraphValidationError, RefinementGraph } from './graph';
export type { EffectEvidence, ExecutionHarness } from './harness';
export type { ObligationRecord } from './obligations';
export { generateObligations } from './obligations';
export type {
  ObligationResult,
  PropagatedEvidence,
  PropagationStatus,
  SpecVerifyResult,
} from './propagation';
export { propagateEvidence } from './propagation';
// New spec types
export type {
  AnySpec,
  LawSpec,
  RequirementSpec,
  SpecKind,
  TargetLocator,
  UsecaseSpec,
} from './specs';
