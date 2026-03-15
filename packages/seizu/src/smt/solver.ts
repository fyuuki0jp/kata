import type { SmtResult } from './ir';

export interface SmtSolver {
  solve(smtLib: string, obligationId: string): Promise<SmtResult>;
}

// Minimal type surface for z3-solver dynamic import (spike-level)
interface Z3Module {
  init: () => Promise<{ Context: new (name: string) => Z3Context }>;
}

interface Z3Context {
  Solver: new () => Z3Solver;
}

interface Z3Solver {
  fromString: (smtLib: string) => void;
  check: () => Promise<string>;
  model: () => Z3Model;
}

interface Z3Model {
  decls: () => Z3Decl[];
  eval: (expr: unknown, complete: boolean) => { toString: () => string };
}

interface Z3Decl {
  name: () => { toString: () => string };
  call: () => unknown;
}

/**
 * Create a Z3 WASM solver instance.
 * Falls back to a mock solver if z3-solver is not available.
 */
export async function createSolver(): Promise<SmtSolver> {
  try {
    // Try to import z3-solver dynamically
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const z3Module = await (Function(
      'return import("z3-solver")'
    )() as Promise<unknown>);
    return new Z3WasmSolver(z3Module as Z3Module);
  } catch {
    // Fallback: return a solver that always returns UNKNOWN
    return new MockSolver();
  }
}

class Z3WasmSolver implements SmtSolver {
  private z3: Z3Module;

  constructor(z3Module: Z3Module) {
    this.z3 = z3Module;
  }

  async solve(smtLib: string, obligationId: string): Promise<SmtResult> {
    try {
      const { Context } = await this.z3.init();
      const ctx = new Context('main');

      // Use Z3's SMT-LIB parser to evaluate
      const solver = new ctx.Solver();

      // Parse and assert the SMT-LIB program
      // Z3 WASM provides fromString for parsing SMT-LIB
      solver.fromString(smtLib);

      const result = await solver.check();

      if (result === 'unsat') {
        return {
          obligationId,
          status: 'PROVED',
          encoding: smtLib,
        };
      } else if (result === 'sat') {
        // Try to extract a counterexample from the model
        const model = solver.model();
        const counterexample: Record<string, unknown> = {};

        try {
          const decls = model.decls();
          for (const decl of decls) {
            const name = decl.name().toString();
            const val = model.eval(decl.call(), true);
            counterexample[name] = val.toString();
          }
        } catch {
          // Model extraction is best-effort
        }

        return {
          obligationId,
          status: 'REFUTED',
          encoding: smtLib,
          counterexample,
        };
      } else {
        return {
          obligationId,
          status: 'UNKNOWN',
          encoding: smtLib,
          reason: 'Z3 returned unknown',
        };
      }
    } catch (e) {
      return {
        obligationId,
        status: 'UNKNOWN',
        encoding: smtLib,
        reason: `Z3 error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}

class MockSolver implements SmtSolver {
  async solve(smtLib: string, obligationId: string): Promise<SmtResult> {
    return {
      obligationId,
      status: 'UNKNOWN',
      encoding: smtLib,
      reason: 'Z3 solver not available (using mock solver)',
    };
  }
}
