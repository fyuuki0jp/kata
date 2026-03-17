import { describe, expect, test } from 'vitest';
import { renderSpecMarkdown } from '../src/doc/spec-renderer';

describe('spec-renderer', () => {
  test('renders dependsOn objects and obligation table', () => {
    const markdown = renderSpecMarkdown(
      {
        specs: [
          {
            kind: 'usecase',
            id: 'UC-1',
            name: 'Checkout flow',
            dependsOn: [{ id: 'REQ-1', mode: 'axiom' }],
            target: { module: 'src/domain/checkout', export: 'execute' },
            given: [{ id: 'auth', description: 'user is authenticated' }],
            ensures: [{ id: 'ok', description: 'checkout completes' }],
            invariants: [],
            errors: [
              { id: 'fail', tag: 'fail', description: 'checkout fails' },
            ],
            effects: [],
            laws: [],
          },
          {
            kind: 'requirement',
            id: 'REQ-1',
            name: 'Baseline',
            dependsOn: [],
            actors: [],
            goal: 'Serve checkout',
            given: [],
            success: [],
            failure: [],
            forbidden: [],
          },
        ],
        obligations: [
          {
            id: 'UC-1:given:auth',
            specId: 'UC-1',
            kind: 'given',
            clauseId: 'auth',
            description: 'user is authenticated',
            status: 'PROVED',
          },
          {
            id: 'REQ-1:dep:UC-1',
            specId: 'REQ-1',
            kind: 'dep',
            clauseId: 'UC-1',
            description: 'depends on UC-1',
            status: 'UNKNOWN',
          },
        ],
        edges: [],
      },
      'Spec Doc'
    );

    expect(markdown).toContain('## Dependency Graph');
    expect(markdown).toContain('UC-1 --> REQ-1');
    expect(markdown).toContain('**Target:** `src/domain/checkout#execute`');
    expect(markdown).toContain('| UC-1:given:auth | UC-1 | given |');
    expect(markdown).toContain('# Spec Doc');
  });
});
