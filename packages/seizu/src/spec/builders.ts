import type { LawSpec, RequirementSpec, UsecaseSpec } from './specs';

export function requirementSpec(
  config: Omit<RequirementSpec, 'kind'>
): RequirementSpec {
  return Object.freeze({ kind: 'requirement' as const, ...config });
}

export function usecaseSpec<I, O, E, S>(
  config: Omit<UsecaseSpec<I, O, E, S>, 'kind'>
): UsecaseSpec<I, O, E, S> {
  // ErrorClause.tag uniqueness check
  const tags = config.errors.map((e) => e.tag);
  const duplicates = tags.filter((t, i) => tags.indexOf(t) !== i);
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate error tags in spec "${config.id}": ${duplicates.join(', ')}`
    );
  }
  return Object.freeze({ kind: 'usecase' as const, ...config });
}

export function lawSpec<TArgs extends Record<string, unknown>, R>(
  config: Omit<LawSpec<TArgs, R>, 'kind'>
): LawSpec<TArgs, R> {
  return Object.freeze({ kind: 'law' as const, ...config });
}
