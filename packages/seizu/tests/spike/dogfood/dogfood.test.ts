import { describe, expect, test } from 'vitest';
import { createSolver, proveGraph } from '../../../src/smt';
import type { SpecVerifyResult } from '../../../src/spec';
import {
  generateObligations,
  propagateEvidence,
  RefinementGraph,
} from '../../../src/spec';
import { verifyLaw } from '../../../src/verify/law-verifier';
import type { AccountState } from './implementation';
import { updateBalances } from './implementation';
import { specs, updateBalancesLaw } from './specs';

describe('Dogfood E2E', () => {
  test('all specs are discoverable', () => {
    expect(specs).toHaveLength(3);
    expect(specs.map((s) => s.id)).toEqual([
      'REQ-OrderPurchase',
      'LAW-UpdateBalances',
      'UC-TransferFunds',
    ]);
  });

  test('graph builds and validates', () => {
    const graph = new RefinementGraph();
    graph.addAll([...specs]);
    const result = graph.validate();
    expect(result.ok).toBe(true);
  });

  test('obligations are generated for all specs', () => {
    const allObligations = specs.flatMap((s) => generateObligations(s));
    expect(allObligations.length).toBeGreaterThan(0);

    // Check obligation ID format
    for (const obl of allObligations) {
      expect(obl.id).toMatch(/^(REQ|UC|LAW)-/);
      expect(obl.id).toContain(':');
    }
  });

  test('LawSpec PBT verification works', () => {
    const result = verifyLaw(updateBalancesLaw, {
      targetFn: (...args: unknown[]) => {
        const [from, to, amount, state] = args;
        return updateBalances(state as AccountState, {
          from: from as string,
          to: to as string,
          amount: amount as number,
        });
      },
      numRuns: 50,
    });

    expect(result.success).toBe(true);
    expect(result.obligations.every((o) => o.status === 'TESTED')).toBe(true);
  });

  test('evidence propagation works end-to-end', () => {
    const graph = new RefinementGraph();
    graph.addAll([...specs]);

    // Simulate: LawSpec is TESTED, UsecaseSpec is TESTED, RequirementSpec has no own obligations
    const results = new Map<string, SpecVerifyResult>();
    results.set('LAW-UpdateBalances', {
      specId: 'LAW-UpdateBalances',
      obligations: [
        {
          obligationId: 'LAW-UpdateBalances:law:conserve-total',
          status: 'TESTED',
        },
        {
          obligationId: 'LAW-UpdateBalances:smt:consistency',
          status: 'PROVED',
        },
      ],
    });
    results.set('UC-TransferFunds', {
      specId: 'UC-TransferFunds',
      obligations: [
        {
          obligationId: 'UC-TransferFunds:given:amount-positive',
          status: 'TESTED',
        },
        {
          obligationId: 'UC-TransferFunds:given:different-accounts',
          status: 'TESTED',
        },
        {
          obligationId: 'UC-TransferFunds:ensure:balance-conservation',
          status: 'TESTED',
        },
        {
          obligationId: 'UC-TransferFunds:error:same-account',
          status: 'TESTED',
        },
        {
          obligationId: 'UC-TransferFunds:error:insufficient-funds',
          status: 'TESTED',
        },
        { obligationId: 'UC-TransferFunds:runtime:no_throw', status: 'TESTED' },
        { obligationId: 'UC-TransferFunds:smt:consistency', status: 'PROVED' },
        {
          obligationId: 'UC-TransferFunds:smt:error_completeness',
          status: 'PROVED',
        },
        {
          obligationId: 'UC-TransferFunds:smt:refinement:LAW-UpdateBalances',
          status: 'PROVED',
        },
      ],
    });
    results.set('REQ-OrderPurchase', {
      specId: 'REQ-OrderPurchase',
      obligations: [
        {
          obligationId: 'REQ-OrderPurchase:dep:UC-TransferFunds',
          status: 'TESTED',
        },
      ],
    });

    const evidence = propagateEvidence(graph, results);

    expect(evidence.get('LAW-UpdateBalances')?.status).toBe('valid');
    expect(evidence.get('UC-TransferFunds')?.status).toBe('valid');
    expect(evidence.get('REQ-OrderPurchase')?.status).toBe('valid');
  });

  test('SMT engine processes the graph', async () => {
    const graph = new RefinementGraph();
    graph.addAll([...specs]);

    const solver = await createSolver();
    const smtResults = await proveGraph(graph, solver);

    // With MockSolver, all results should be UNKNOWN
    // With real Z3, some should be PROVED
    expect(smtResults.length).toBeGreaterThan(0);
    for (const result of smtResults) {
      expect(['PROVED', 'REFUTED', 'UNKNOWN']).toContain(result.status);
    }
  });

  test('REFUTED propagates correctly', () => {
    const graph = new RefinementGraph();
    graph.addAll([...specs]);

    const results = new Map<string, SpecVerifyResult>();
    results.set('LAW-UpdateBalances', {
      specId: 'LAW-UpdateBalances',
      obligations: [
        {
          obligationId: 'LAW-UpdateBalances:law:conserve-total',
          status: 'REFUTED',
        },
      ],
    });
    results.set('UC-TransferFunds', {
      specId: 'UC-TransferFunds',
      obligations: [
        {
          obligationId: 'UC-TransferFunds:ensure:balance-conservation',
          status: 'TESTED',
        },
      ],
    });
    results.set('REQ-OrderPurchase', {
      specId: 'REQ-OrderPurchase',
      obligations: [
        {
          obligationId: 'REQ-OrderPurchase:dep:UC-TransferFunds',
          status: 'TESTED',
        },
      ],
    });

    const evidence = propagateEvidence(graph, results);

    // LAW is REFUTED -> UC depends on LAW -> UC is invalid -> REQ depends on UC -> REQ is invalid
    expect(evidence.get('LAW-UpdateBalances')?.status).toBe('refuted');
    expect(evidence.get('UC-TransferFunds')?.status).toBe('invalid');
    expect(evidence.get('REQ-OrderPurchase')?.status).toBe('invalid');
  });
});
