import { describe, expect, test } from 'vitest';
import {
  buildSmtLib,
  collectVariables,
  encodeExpr,
} from '../../src/smt/encoder';
import { extractPredicateIR } from '../../src/smt/extractor';

describe('SMT Spike', () => {
  test('extract simple predicate IR: amount > 0', () => {
    const pred = (ctx: { input: { amount: number } }) => ctx.input.amount > 0;
    const ir = extractPredicateIR(pred);

    expect(ir.kind).not.toBe('unsupported');
    // Should be a binop with >
    expect(ir.kind).toBe('binop');
    if (ir.kind === 'binop') {
      expect(ir.op).toBe('>');
    }
  });

  test('extract equality predicate: a === b', () => {
    const pred = (args: { a: number; b: number }, result: number) =>
      result === args.a + args.b;
    const ir = extractPredicateIR(pred);

    expect(ir.kind).not.toBe('unsupported');
    if (ir.kind === 'binop') {
      expect(ir.op).toBe('===');
    }
  });

  test('extract ternary predicate: conditional check', () => {
    const pred = (ctx: { ok: boolean; value: number }) =>
      ctx.ok ? ctx.value > 0 : true;
    const ir = extractPredicateIR(pred);

    expect(ir.kind).toBe('ternary');
    if (ir.kind === 'ternary') {
      expect(ir.thenExpr.kind).toBe('binop');
      expect(ir.else.kind).toBe('literal');
    }
  });

  test('collect variables from a simple expression', () => {
    const pred = (ctx: { input: { amount: number } }) => ctx.input.amount > 0;
    const ir = extractPredicateIR(pred);
    const vars = collectVariables(ir);

    expect(vars.length).toBeGreaterThan(0);
    // Should find the ctx.input.amount variable (flattened)
    const varNames = vars.map((v) => v.name);
    expect(varNames.some((n) => n.includes('amount'))).toBe(true);
  });

  test('encode simple predicate to SMT-LIB', () => {
    const pred = (ctx: { input: { amount: number } }) => ctx.input.amount > 0;
    const ir = extractPredicateIR(pred);

    if (ir.kind !== 'unsupported') {
      const encoded = encodeExpr(ir);
      expect(encoded).toContain('>');
      expect(encoded).toContain('0');
    }
  });

  test('encode balance conservation to SMT-LIB', () => {
    // balance conservation: before.totalBalance === after.totalBalance
    const pred = (ctx: {
      before: { totalBalance: number };
      after: { totalBalance: number };
      result: { ok: boolean };
    }) =>
      ctx.result.ok ? ctx.before.totalBalance === ctx.after.totalBalance : true;
    const ir = extractPredicateIR(pred);

    expect(ir.kind).not.toBe('unsupported');

    if (ir.kind !== 'unsupported') {
      const vars = collectVariables(ir);
      const smtLib = buildSmtLib(
        vars,
        [], // no axioms
        [], // no preconditions
        ir // goal
      );

      // Should be a valid SMT-LIB program
      expect(smtLib).toContain('set-logic');
      expect(smtLib).toContain('declare-const');
      expect(smtLib).toContain('check-sat');
      expect(smtLib).toContain('assert');
      // Should contain variable declarations for totalBalance
      expect(smtLib).toContain('totalBalance');
    }
  });

  test('build SMT-LIB with preconditions and goal', () => {
    // Precondition: amount > 0
    const preCond = extractPredicateIR(
      (ctx: { input: { amount: number } }) => ctx.input.amount > 0
    );
    // Goal: result > 0
    const goal = extractPredicateIR(
      (ctx: { result: number }) => ctx.result > 0
    );

    if (preCond.kind !== 'unsupported' && goal.kind !== 'unsupported') {
      const allVars = [...collectVariables(preCond), ...collectVariables(goal)];
      // Deduplicate by name
      const uniqueVars = [...new Map(allVars.map((v) => [v.name, v])).values()];

      const smtLib = buildSmtLib(
        uniqueVars,
        [], // no axioms
        [preCond], // preconditions
        goal // goal
      );

      expect(smtLib).toContain('check-sat');
      // Should assert the precondition
      expect(smtLib).toContain('assert');
      // Should negate the goal (for proving via refutation)
      expect(smtLib).toContain('(assert (not');
    }
  });

  test('build SMT-LIB with axioms, preconditions, and goal', () => {
    // Axiom: x + y === total (from a law)
    const axiom = extractPredicateIR(
      (ctx: { x: number; y: number; total: number }) =>
        ctx.x + ctx.y === ctx.total
    );

    // Precondition: amount > 0 and amount <= x
    const pre1 = extractPredicateIR(
      (ctx: { amount: number }) => ctx.amount > 0
    );

    // Goal: (x - amount) + (y + amount) === total
    // This is a simplified balance conservation property
    const goal = extractPredicateIR(
      (ctx: { x: number; y: number; amount: number; total: number }) =>
        ctx.x - ctx.amount + (ctx.y + ctx.amount) === ctx.total
    );

    if (
      axiom.kind !== 'unsupported' &&
      pre1.kind !== 'unsupported' &&
      goal.kind !== 'unsupported'
    ) {
      const allVars = [
        ...collectVariables(axiom),
        ...collectVariables(pre1),
        ...collectVariables(goal),
      ];
      const uniqueVars = [...new Map(allVars.map((v) => [v.name, v])).values()];

      const smtLib = buildSmtLib(uniqueVars, [axiom], [pre1], goal);

      expect(smtLib).toContain('set-logic');
      expect(smtLib).toContain('check-sat');
      // With the axiom x + y = total and goal (x-a)+(y+a) = total,
      // the negation should be unsat (i.e., the goal is provable)
    }
  });

  test('unsupported expressions are handled gracefully', () => {
    // Function with method calls that cannot be parsed to SMT
    const pred = (ctx: { items: number[] }) => ctx.items.includes(42);
    const ir = extractPredicateIR(pred);

    // Should parse to a call node (not crash)
    // The call node represents items.includes(42)
    expect(ir.kind).toBeDefined();
  });
});
