/**
 * Spec-based documentation renderer.
 *
 * Reads a compiled graph.json and generates Markdown with:
 * - Mermaid dependency graph
 * - RequirementSpec / UsecaseSpec / LawSpec sections
 * - Obligation status table
 * - Evidence summary
 */

// ---- Inline types for the serialised graph.json ----

interface SerializedSpec {
  readonly kind: 'requirement' | 'usecase' | 'law';
  readonly id: string;
  readonly name: string;
  readonly dependsOn: readonly string[];
  // RequirementSpec fields
  readonly actors?: readonly string[];
  readonly goal?: string;
  readonly given?: readonly {
    id: string;
    text?: string;
    description?: string;
  }[];
  readonly success?: readonly { id: string; text: string }[];
  readonly failure?: readonly { id: string; text: string }[];
  readonly forbidden?: readonly { id: string; text: string }[];
  // UsecaseSpec fields
  readonly target?: { module: string; export: string };
  readonly ensures?: readonly { id: string; description: string }[];
  readonly invariants?: readonly { id: string; description: string }[];
  readonly errors?: readonly {
    id: string;
    tag?: string;
    description: string;
  }[];
  readonly effects?: readonly {
    id: string;
    facet?: string;
    description: string;
  }[];
  // LawSpec fields
  readonly laws?: readonly { id: string; description: string }[];
}

interface SerializedObligation {
  readonly id: string;
  readonly specId: string;
  readonly kind: string;
  readonly clauseId: string;
  readonly description: string;
  readonly status?: string; // ObligationStatus value
}

export interface GraphJson {
  readonly specs: readonly SerializedSpec[];
  readonly obligations: readonly SerializedObligation[];
  readonly edges: readonly { from: string; to: string }[];
}

// ---- Colour helpers ----

type NodeColour = '#90EE90' | '#87CEEB' | '#FFB6C1' | '#D3D3D3';

function pickColour(
  specId: string,
  obligations: readonly SerializedObligation[]
): NodeColour {
  const own = obligations.filter((o) => o.specId === specId);
  if (own.length === 0) return '#D3D3D3';
  const statuses = own.map((o) => o.status ?? 'UNKNOWN');
  if (statuses.some((s) => s === 'REFUTED')) return '#FFB6C1';
  if (statuses.every((s) => s === 'PROVED' || s === 'TESTED')) return '#90EE90';
  if (statuses.some((s) => s === 'UNKNOWN')) return '#87CEEB';
  return '#D3D3D3';
}

// ---- Public API ----

export function renderSpecMarkdown(graph: GraphJson, title?: string): string {
  const lines: string[] = [];

  lines.push(`# ${title ?? 'Spec Documentation'}`);
  lines.push('');

  // ---- Dependency Graph (Mermaid) ----
  lines.push('## Dependency Graph');
  lines.push('');
  lines.push('```mermaid');
  lines.push('graph TD');

  for (const edge of graph.edges) {
    lines.push(`  ${edge.from} --> ${edge.to}`);
  }

  for (const spec of graph.specs) {
    const colour = pickColour(spec.id, graph.obligations);
    lines.push(`  style ${spec.id} fill:${colour}`);
  }

  lines.push('```');
  lines.push('');

  // ---- Per-spec sections ----
  const requirements = graph.specs.filter((s) => s.kind === 'requirement');
  const usecases = graph.specs.filter((s) => s.kind === 'usecase');
  const lawSpecs = graph.specs.filter((s) => s.kind === 'law');

  if (requirements.length > 0) {
    lines.push('## Requirements');
    lines.push('');
    for (const spec of requirements) {
      lines.push(`### ${spec.name} (\`${spec.id}\`)`);
      lines.push('');
      if (spec.actors && spec.actors.length > 0) {
        lines.push(`**Actors:** ${spec.actors.join(', ')}`);
        lines.push('');
      }
      if (spec.goal) {
        lines.push(`**Goal:** ${spec.goal}`);
        lines.push('');
      }
      renderClauseList(lines, 'Given', spec.given);
      renderClauseList(lines, 'Success', spec.success);
      renderClauseList(lines, 'Failure', spec.failure);
      renderClauseList(lines, 'Forbidden', spec.forbidden);
    }
  }

  if (usecases.length > 0) {
    lines.push('## Use Cases');
    lines.push('');
    for (const spec of usecases) {
      lines.push(`### ${spec.name} (\`${spec.id}\`)`);
      lines.push('');
      if (spec.target) {
        lines.push(
          `**Target:** \`${spec.target.module}#${spec.target.export}\``
        );
        lines.push('');
      }
      renderClauseSection(lines, 'Given', spec.given);
      renderClauseSection(lines, 'Ensures', spec.ensures);
      renderClauseSection(lines, 'Invariants', spec.invariants);
      renderClauseSection(lines, 'Errors', spec.errors);
      renderClauseSection(lines, 'Effects', spec.effects);
    }
  }

  if (lawSpecs.length > 0) {
    lines.push('## Laws');
    lines.push('');
    for (const spec of lawSpecs) {
      lines.push(`### ${spec.name} (\`${spec.id}\`)`);
      lines.push('');
      if (spec.target) {
        lines.push(
          `**Target:** \`${spec.target.module}#${spec.target.export}\``
        );
        lines.push('');
      }
      renderClauseSection(lines, 'Laws', spec.laws);
    }
  }

  // ---- Obligation Status Table ----
  lines.push('## Obligation Status');
  lines.push('');
  lines.push('| ID | Spec | Kind | Description | Status |');
  lines.push('|----|------|------|-------------|--------|');

  for (const ob of graph.obligations) {
    const status = ob.status ?? 'UNKNOWN';
    lines.push(
      `| ${ob.id} | ${ob.specId} | ${ob.kind} | ${ob.description} | ${status} |`
    );
  }
  lines.push('');

  // ---- Evidence Summary ----
  const statusCounts: Record<string, number> = {
    PROVED: 0,
    TESTED: 0,
    REFUTED: 0,
    UNKNOWN: 0,
    ASSUMED: 0,
  };
  for (const ob of graph.obligations) {
    const s = ob.status ?? 'UNKNOWN';
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }

  lines.push('## Evidence Summary');
  lines.push('');
  lines.push(`- **PROVED:** ${statusCounts.PROVED}`);
  lines.push(`- **TESTED:** ${statusCounts.TESTED}`);
  lines.push(`- **REFUTED:** ${statusCounts.REFUTED}`);
  lines.push(`- **UNKNOWN:** ${statusCounts.UNKNOWN}`);
  lines.push(`- **ASSUMED:** ${statusCounts.ASSUMED}`);
  lines.push('');

  return lines.join('\n');
}

// ---- Internal helpers ----

function renderClauseList(
  lines: string[],
  heading: string,
  items:
    | readonly { id: string; text?: string; description?: string }[]
    | undefined
): void {
  if (!items || items.length === 0) return;
  lines.push(`**${heading}:**`);
  lines.push('');
  for (const item of items) {
    lines.push(`- \`${item.id}\`: ${item.text ?? item.description ?? ''}`);
  }
  lines.push('');
}

function renderClauseSection(
  lines: string[],
  heading: string,
  items: readonly { id: string; description?: string }[] | undefined
): void {
  if (!items || items.length === 0) return;
  lines.push(`**${heading}:**`);
  lines.push('');
  for (const item of items) {
    lines.push(`- \`${item.id}\`: ${item.description ?? ''}`);
  }
  lines.push('');
}
