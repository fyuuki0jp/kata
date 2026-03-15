import type { Result } from '../result';
import { err, ok } from '../result';
import { specRefId } from './clauses';
import type { AnySpec } from './specs';

export class CycleError extends Error {
  override readonly name = 'CycleError';
  constructor(readonly cycle: readonly string[]) {
    super(`Cycle detected in spec graph: ${cycle.join(' → ')}`);
  }
}

export class GraphValidationError extends Error {
  override readonly name = 'GraphValidationError';
  constructor(readonly issues: readonly string[]) {
    super(`Graph validation failed:\n${issues.join('\n')}`);
  }
}

export class RefinementGraph {
  private readonly nodes = new Map<string, AnySpec>();
  private readonly edges = new Map<string, Set<string>>();

  add(spec: AnySpec): void {
    this.nodes.set(spec.id, spec);
    if (!this.edges.has(spec.id)) {
      this.edges.set(spec.id, new Set());
    }
    for (const dep of spec.dependsOn) {
      this.edges.get(spec.id)?.add(specRefId(dep));
    }
  }

  addAll(specs: readonly AnySpec[]): void {
    for (const spec of specs) this.add(spec);
  }

  get(id: string): AnySpec | undefined {
    return this.nodes.get(id);
  }

  allSpecs(): readonly AnySpec[] {
    return [...this.nodes.values()];
  }

  dependencies(id: string): readonly string[] {
    return [...(this.edges.get(id) ?? [])];
  }

  dependants(id: string): readonly string[] {
    const result: string[] = [];
    for (const [nodeId, deps] of this.edges) {
      if (deps.has(id)) result.push(nodeId);
    }
    return result;
  }

  topologicalSort(): readonly string[] {
    const inDegree = new Map<string, number>();
    for (const id of this.nodes.keys()) inDegree.set(id, 0);
    for (const [, deps] of this.edges) {
      for (const dep of deps) {
        if (this.nodes.has(dep)) {
          inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift();
      if (node === undefined) break;
      sorted.push(node);
      for (const dep of this.edges.get(node) ?? []) {
        if (!this.nodes.has(dep)) continue;
        const newDeg = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) queue.push(dep);
      }
    }

    if (sorted.length !== this.nodes.size) {
      const remaining = [...this.nodes.keys()].filter(
        (id) => !sorted.includes(id)
      );
      throw new CycleError(remaining);
    }

    return sorted;
  }

  validate(): Result<void, GraphValidationError> {
    const issues: string[] = [];

    // Check for unresolved references
    for (const [specId, deps] of this.edges) {
      for (const dep of deps) {
        if (!this.nodes.has(dep)) {
          issues.push(
            `Spec "${specId}" depends on "${dep}" which does not exist`
          );
        }
      }
    }

    // Check for cycles
    try {
      this.topologicalSort();
    } catch (e) {
      if (e instanceof CycleError) {
        issues.push(`Cycle detected: ${e.cycle.join(' → ')}`);
      }
    }

    // Check duplicate IDs
    // (already handled by Map, but check for consistency)

    if (issues.length > 0) return err(new GraphValidationError(issues));
    return ok(undefined);
  }
}
