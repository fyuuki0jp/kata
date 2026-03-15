import type { SmtBinOp, SmtExpr, SmtSort, SmtVar } from './ir';

export interface SmtEncoding {
  readonly declarations: readonly string[];
  readonly assertions: readonly string[];
  readonly checkSat: string;
}

/**
 * Collect all variables referenced in an expression.
 * Walks the IR tree and gathers all leaf var/prop references,
 * flattening property chains into SMT variable names.
 */
export function collectVariables(expr: SmtExpr): SmtVar[] {
  const vars = new Map<string, SmtVar>();
  collectVarsRecursive(expr, vars);
  return [...vars.values()];
}

function collectVarsRecursive(expr: SmtExpr, vars: Map<string, SmtVar>): void {
  switch (expr.kind) {
    case 'var': {
      const name =
        expr.path.length > 0
          ? `${expr.name}_${expr.path.join('_')}`
          : expr.name;
      if (!vars.has(name)) {
        vars.set(name, { name, sort: 'Int' }); // default to Int
      }
      break;
    }
    case 'prop': {
      const flat = flattenPropAccess(expr);
      if (!vars.has(flat)) {
        vars.set(flat, { name: flat, sort: 'Int' }); // default to Int
      }
      break;
    }
    case 'literal': {
      // No variables to collect; but we can use this to infer sorts of siblings
      break;
    }
    case 'binop': {
      collectVarsRecursive(expr.left, vars);
      collectVarsRecursive(expr.right, vars);
      // Infer sorts based on context
      inferSortsFromBinop(expr, vars);
      break;
    }
    case 'unop':
      collectVarsRecursive(expr.expr, vars);
      if (expr.op === '!') {
        // The operand should be Bool
        markSort(expr.expr, vars, 'Bool');
      }
      break;
    case 'ternary':
      collectVarsRecursive(expr.cond, vars);
      collectVarsRecursive(expr.thenExpr, vars);
      collectVarsRecursive(expr.else, vars);
      markSort(expr.cond, vars, 'Bool');
      break;
    case 'call':
      for (const arg of expr.args) {
        collectVarsRecursive(arg, vars);
      }
      break;
    case 'forall':
    case 'exists':
      collectVarsRecursive(expr.domain, vars);
      collectVarsRecursive(expr.body, vars);
      // Remove the bound variable from collected vars (it's locally scoped)
      vars.delete(expr.varName);
      break;
    case 'length': {
      const lengthName = `${flattenPropAccess(expr.obj)}_length`;
      if (!vars.has(lengthName)) {
        vars.set(lengthName, { name: lengthName, sort: 'Int' });
      }
      break;
    }
    case 'unsupported':
      break;
  }
}

function inferSortsFromBinop(
  expr: SmtExpr & { kind: 'binop' },
  vars: Map<string, SmtVar>
): void {
  const boolOps: SmtBinOp[] = ['&&', '||'];
  const compOps: SmtBinOp[] = ['===', '!==', '<', '>', '<=', '>='];

  if (boolOps.includes(expr.op)) {
    markSort(expr.left, vars, 'Bool');
    markSort(expr.right, vars, 'Bool');
  } else if (compOps.includes(expr.op)) {
    // Comparison result is Bool, but operands might be Int, Bool, or String
    if (isBoolLiteral(expr.left)) markSort(expr.right, vars, 'Bool');
    if (isBoolLiteral(expr.right)) markSort(expr.left, vars, 'Bool');
    if (isStringLiteral(expr.left)) markSort(expr.right, vars, 'String');
    if (isStringLiteral(expr.right)) markSort(expr.left, vars, 'String');
  }
}

function isBoolLiteral(expr: SmtExpr): boolean {
  return expr.kind === 'literal' && typeof expr.value === 'boolean';
}

function isStringLiteral(expr: SmtExpr): boolean {
  return expr.kind === 'literal' && typeof expr.value === 'string';
}

function markSort(
  expr: SmtExpr,
  vars: Map<string, SmtVar>,
  sort: SmtSort
): void {
  const name = exprToVarName(expr);
  if (name && vars.has(name)) {
    vars.set(name, { name, sort });
  }
}

function exprToVarName(expr: SmtExpr): string | null {
  if (expr.kind === 'var') {
    return expr.path.length > 0
      ? `${expr.name}_${expr.path.join('_')}`
      : expr.name;
  }
  if (expr.kind === 'prop') {
    return flattenPropAccess(expr);
  }
  return null;
}

/**
 * Flatten a chain of property accesses to a single SMT variable name.
 * ctx.input.amount -> ctx_input_amount
 */
export function flattenPropAccess(expr: SmtExpr): string {
  if (expr.kind === 'prop') {
    return `${flattenPropAccess(expr.obj)}_${expr.prop}`;
  }
  if (expr.kind === 'var') {
    return expr.path.length > 0
      ? `${expr.name}_${expr.path.join('_')}`
      : expr.name;
  }
  // Fallback
  return '_unknown_';
}

/**
 * Encode an SmtExpr to SMT-LIB format string.
 */
export function encodeExpr(expr: SmtExpr): string {
  switch (expr.kind) {
    case 'literal':
      if (typeof expr.value === 'boolean') return expr.value.toString();
      if (typeof expr.value === 'string') return `"${expr.value}"`;
      if (expr.value < 0) return `(- ${Math.abs(expr.value)})`;
      return expr.value.toString();
    case 'var':
      return expr.path.length > 0
        ? `${expr.name}_${expr.path.join('_')}`
        : expr.name;
    case 'prop':
      return flattenPropAccess(expr);
    case 'binop':
      return encodeBinOp(
        expr.op,
        encodeExpr(expr.left),
        encodeExpr(expr.right)
      );
    case 'unop':
      return encodeUnOp(expr.op, encodeExpr(expr.expr));
    case 'ternary':
      return `(ite ${encodeExpr(expr.cond)} ${encodeExpr(expr.thenExpr)} ${encodeExpr(expr.else)})`;
    case 'call':
      return `(${expr.callee} ${expr.args.map((a) => encodeExpr(a)).join(' ')})`;
    case 'length':
      return `${flattenPropAccess(expr.obj)}_length`;
    case 'forall': {
      const forallBody = encodeExpr(expr.body);
      const forallDomain = flattenPropAccess(expr.domain);
      return `(forall ((${expr.varName} Int)) (=> (member_of_${forallDomain} ${expr.varName}) ${forallBody}))`;
    }
    case 'exists': {
      const existsBody = encodeExpr(expr.body);
      const existsDomain = flattenPropAccess(expr.domain);
      return `(exists ((${expr.varName} Int)) (and (member_of_${existsDomain} ${expr.varName}) ${existsBody}))`;
    }
    case 'unsupported':
      throw new SmtEncodingError(expr.reason);
  }
}

function encodeBinOp(op: SmtBinOp, left: string, right: string): string {
  switch (op) {
    case '===':
      return `(= ${left} ${right})`;
    case '!==':
      return `(not (= ${left} ${right}))`;
    case '&&':
      return `(and ${left} ${right})`;
    case '||':
      return `(or ${left} ${right})`;
    case '+':
      return `(+ ${left} ${right})`;
    case '-':
      return `(- ${left} ${right})`;
    case '*':
      return `(* ${left} ${right})`;
    case '/':
      return `(div ${left} ${right})`;
    case '%':
      return `(mod ${left} ${right})`;
    case '<':
      return `(< ${left} ${right})`;
    case '>':
      return `(> ${left} ${right})`;
    case '<=':
      return `(<= ${left} ${right})`;
    case '>=':
      return `(>= ${left} ${right})`;
  }
}

function encodeUnOp(op: string, operand: string): string {
  switch (op) {
    case '!':
      return `(not ${operand})`;
    case '-':
      return `(- ${operand})`;
    default:
      return `(${op} ${operand})`;
  }
}

/**
 * Check if an expression tree contains string literals.
 * If so, we need to use a string-capable logic.
 */
export function hasStrings(expr: SmtExpr): boolean {
  switch (expr.kind) {
    case 'literal':
      return typeof expr.value === 'string';
    case 'binop':
      return hasStrings(expr.left) || hasStrings(expr.right);
    case 'unop':
      return hasStrings(expr.expr);
    case 'ternary':
      return (
        hasStrings(expr.cond) ||
        hasStrings(expr.thenExpr) ||
        hasStrings(expr.else)
      );
    case 'prop':
      return hasStrings(expr.obj);
    case 'call':
      return expr.args.some((a) => hasStrings(a));
    case 'forall':
      return hasStrings(expr.domain) || hasStrings(expr.body);
    case 'exists':
      return hasStrings(expr.domain) || hasStrings(expr.body);
    case 'length':
      return hasStrings(expr.obj);
    default:
      return false;
  }
}

/**
 * Check if an expression tree contains quantifiers (forall/exists).
 * If so, we need to upgrade the logic from QF_LIA to LIA.
 */
export function hasQuantifiers(expr: SmtExpr): boolean {
  switch (expr.kind) {
    case 'forall':
    case 'exists':
      return true;
    case 'binop':
      return hasQuantifiers(expr.left) || hasQuantifiers(expr.right);
    case 'unop':
      return hasQuantifiers(expr.expr);
    case 'ternary':
      return (
        hasQuantifiers(expr.cond) ||
        hasQuantifiers(expr.thenExpr) ||
        hasQuantifiers(expr.else)
      );
    case 'length':
      return hasQuantifiers(expr.obj);
    default:
      return false;
  }
}

/**
 * Build a complete SMT-LIB program for a proof obligation.
 *
 * Uses the standard Assume-Guarantee pattern:
 * - Declare all variables
 * - Assert axioms (dependency ensures)
 * - Assert preconditions (given clauses)
 * - Assert negation of goal
 * - check-sat: unsat = PROVED, sat = REFUTED
 */
export function buildSmtLib(
  declarations: readonly SmtVar[],
  axioms: readonly SmtExpr[],
  preconditions: readonly SmtExpr[],
  goal: SmtExpr
): string {
  const lines: string[] = [];

  // Choose logic based on expression features
  const allExprs = [...axioms, ...preconditions, goal];
  const needsQuantifiers = allExprs.some((e) => hasQuantifiers(e));
  const needsStrings = allExprs.some((e) => hasStrings(e));
  const logic = needsStrings
    ? needsQuantifiers
      ? 'ALL'
      : 'QF_SLIA'
    : needsQuantifiers
      ? 'LIA'
      : 'QF_LIA';
  lines.push(`(set-logic ${logic})`);
  lines.push('');

  // Declare constants
  for (const v of declarations) {
    lines.push(`(declare-const ${v.name} ${v.sort})`);
  }
  lines.push('');

  // Assert axioms (throws SmtEncodingError if unsupported)
  for (const axiom of axioms) {
    lines.push(`(assert ${encodeExpr(axiom)})`);
  }

  // Assert preconditions (throws SmtEncodingError if unsupported)
  for (const pre of preconditions) {
    lines.push(`(assert ${encodeExpr(pre)})`);
  }

  lines.push('');

  // Negate the goal: if (not goal) is unsat, then goal is valid
  // Throws SmtEncodingError if unsupported
  lines.push(`(assert (not ${encodeExpr(goal)}))`);

  lines.push('');
  lines.push('(check-sat)');

  return lines.join('\n');
}

export class SmtEncodingError extends Error {
  override readonly name = 'SmtEncodingError';
}
