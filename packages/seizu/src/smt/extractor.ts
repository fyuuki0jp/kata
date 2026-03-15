import type { SmtBinOp, SmtExpr } from './ir';

/**
 * Extract SMT IR from a predicate function.
 * Uses Function.prototype.toString() to get the source and parses it.
 *
 * Spike implementation: simplified parser for common patterns.
 * Production: use TypeScript compiler API for proper AST parsing.
 */
export function extractPredicateIR(fn: (...args: never) => unknown): SmtExpr {
  const source = fn.toString();
  try {
    return parseArrowFunction(source);
  } catch {
    return {
      kind: 'unsupported',
      reason: `Failed to parse: ${source.slice(0, 100)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

interface Token {
  readonly type:
    | 'number'
    | 'boolean'
    | 'ident'
    | 'dot'
    | 'op'
    | 'lparen'
    | 'rparen'
    | 'question'
    | 'colon'
    | 'not'
    | 'comma'
    | 'lbrace'
    | 'rbrace'
    | 'arrow'
    | 'eof';
  readonly value: string;
}

const _OPERATORS = new Set([
  '===',
  '!==',
  '<=',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '=',
]);

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    // Skip whitespace
    if (/\s/.test(source[i])) {
      i++;
      continue;
    }

    // Arrow
    if (source[i] === '=' && source[i + 1] === '>') {
      tokens.push({ type: 'arrow', value: '=>' });
      i += 2;
      continue;
    }

    // Three-char operators
    if (i + 2 < source.length) {
      const tri = source.slice(i, i + 3);
      if (tri === '===' || tri === '!==') {
        tokens.push({ type: 'op', value: tri });
        i += 3;
        continue;
      }
    }

    // Two-char operators
    if (i + 1 < source.length) {
      const bi = source.slice(i, i + 2);
      if (bi === '<=' || bi === '>=' || bi === '&&' || bi === '||') {
        tokens.push({ type: 'op', value: bi });
        i += 2;
        continue;
      }
    }

    // Single-char operators
    if ('+-*/%'.includes(source[i])) {
      tokens.push({ type: 'op', value: source[i] });
      i++;
      continue;
    }

    if (source[i] === '<' || source[i] === '>') {
      tokens.push({ type: 'op', value: source[i] });
      i++;
      continue;
    }

    if (source[i] === '!') {
      tokens.push({ type: 'not', value: '!' });
      i++;
      continue;
    }

    if (source[i] === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
      continue;
    }
    if (source[i] === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
      continue;
    }
    if (source[i] === '{') {
      tokens.push({ type: 'lbrace', value: '{' });
      i++;
      continue;
    }
    if (source[i] === '}') {
      tokens.push({ type: 'rbrace', value: '}' });
      i++;
      continue;
    }
    if (source[i] === '.') {
      tokens.push({ type: 'dot', value: '.' });
      i++;
      continue;
    }
    if (source[i] === '?') {
      tokens.push({ type: 'question', value: '?' });
      i++;
      continue;
    }
    if (source[i] === ':') {
      tokens.push({ type: 'colon', value: ':' });
      i++;
      continue;
    }
    if (source[i] === ',') {
      tokens.push({ type: 'comma', value: ',' });
      i++;
      continue;
    }

    // Numbers
    if (
      /[0-9]/.test(source[i]) ||
      (source[i] === '-' &&
        i + 1 < source.length &&
        /[0-9]/.test(source[i + 1]))
    ) {
      let num = '';
      if (source[i] === '-') {
        num += '-';
        i++;
      }
      while (i < source.length && /[0-9.]/.test(source[i])) {
        num += source[i];
        i++;
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_$]/.test(source[i])) {
      let ident = '';
      while (i < source.length && /[a-zA-Z0-9_$]/.test(source[i])) {
        ident += source[i];
        i++;
      }
      if (ident === 'true' || ident === 'false') {
        tokens.push({ type: 'boolean', value: ident });
      } else {
        tokens.push({ type: 'ident', value: ident });
      }
      continue;
    }

    // Skip unknown characters
    i++;
  }

  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser state
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;
  private readonly paramMap: Map<string, string[]>;

  constructor(
    private readonly tokens: Token[],
    paramMap: Map<string, string[]>
  ) {
    this.paramMap = paramMap;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: 'eof', value: '' };
  }

  private advance(): Token {
    const t = this.tokens[this.pos];
    this.pos++;
    return t;
  }

  private expect(type: Token['type'], value?: string): Token {
    const t = this.advance();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(
        `Expected ${type}${value ? `(${value})` : ''}, got ${t.type}(${t.value})`
      );
    }
    return t;
  }

  // Expression parsing with precedence climbing
  // Precedence (low to high):
  //   ternary (? :)
  //   || (logical or)
  //   && (logical and)
  //   ==, !=, <, >, <=, >= (comparison)
  //   +, - (additive)
  //   *, /, % (multiplicative)
  //   unary (!, -)
  //   primary (literals, identifiers, parenthesized, property access)

  parse(): SmtExpr {
    const result = this.parseTernary();
    return result;
  }

  private parseTernary(): SmtExpr {
    const cond = this.parseOr();
    if (this.peek().type === 'question') {
      this.advance(); // consume ?
      const thenExpr = this.parseTernary();
      this.expect('colon');
      const elseExpr = this.parseTernary();
      return { kind: 'ternary', cond, thenExpr: thenExpr, else: elseExpr };
    }
    return cond;
  }

  private parseOr(): SmtExpr {
    let left = this.parseAnd();
    while (this.peek().type === 'op' && this.peek().value === '||') {
      this.advance();
      const right = this.parseAnd();
      left = { kind: 'binop', op: '||', left, right };
    }
    return left;
  }

  private parseAnd(): SmtExpr {
    let left = this.parseComparison();
    while (this.peek().type === 'op' && this.peek().value === '&&') {
      this.advance();
      const right = this.parseComparison();
      left = { kind: 'binop', op: '&&', left, right };
    }
    return left;
  }

  private parseComparison(): SmtExpr {
    let left = this.parseAdditive();
    const compOps = ['===', '!==', '<', '>', '<=', '>='];
    while (this.peek().type === 'op' && compOps.includes(this.peek().value)) {
      const op = this.advance().value as SmtBinOp;
      const right = this.parseAdditive();
      left = { kind: 'binop', op, left, right };
    }
    return left;
  }

  private parseAdditive(): SmtExpr {
    let left = this.parseMultiplicative();
    while (
      this.peek().type === 'op' &&
      (this.peek().value === '+' || this.peek().value === '-')
    ) {
      const op = this.advance().value as SmtBinOp;
      const right = this.parseMultiplicative();
      left = { kind: 'binop', op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): SmtExpr {
    let left = this.parseUnary();
    while (
      this.peek().type === 'op' &&
      (this.peek().value === '*' ||
        this.peek().value === '/' ||
        this.peek().value === '%')
    ) {
      const op = this.advance().value as SmtBinOp;
      const right = this.parseUnary();
      left = { kind: 'binop', op, left, right };
    }
    return left;
  }

  private parseUnary(): SmtExpr {
    if (this.peek().type === 'not') {
      this.advance();
      const expr = this.parseUnary();
      return { kind: 'unop', op: '!', expr };
    }
    if (this.peek().type === 'op' && this.peek().value === '-') {
      this.advance();
      const expr = this.parseUnary();
      // Optimize: if expr is a literal number, negate it directly
      if (expr.kind === 'literal' && typeof expr.value === 'number') {
        return { kind: 'literal', value: -expr.value };
      }
      return { kind: 'unop', op: '-', expr };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): SmtExpr {
    const t = this.peek();

    // Parenthesized expression
    if (t.type === 'lparen') {
      this.advance();
      const expr = this.parseTernary();
      this.expect('rparen');
      return this.parsePostfix(expr);
    }

    // Number literal
    if (t.type === 'number') {
      this.advance();
      const n = Number(t.value);
      return { kind: 'literal', value: Number.isInteger(n) ? n : n };
    }

    // Boolean literal
    if (t.type === 'boolean') {
      this.advance();
      return { kind: 'literal', value: t.value === 'true' };
    }

    // Identifier (possibly with property access)
    if (t.type === 'ident') {
      this.advance();
      const name = t.value;

      // Check if this is a destructured param — expand to full path
      if (this.paramMap.has(name)) {
        const basePath = this.paramMap.get(name);
        if (!basePath) {
          return { kind: 'unsupported', reason: `Unknown param: ${name}` };
        }
        const expr: SmtExpr = {
          kind: 'var',
          name: basePath[0],
          path: basePath.slice(1),
        };
        // If there are remaining path segments, wrap in prop
        return this.parsePostfix(expr);
      }

      const expr: SmtExpr = { kind: 'var', name, path: [] };
      return this.parsePostfix(expr);
    }

    return {
      kind: 'unsupported',
      reason: `Unexpected token: ${t.type}(${t.value})`,
    };
  }

  private parsePostfix(expr: SmtExpr): SmtExpr {
    while (true) {
      if (this.peek().type === 'dot') {
        this.advance();
        const prop = this.expect('ident');
        expr = { kind: 'prop', obj: expr, prop: prop.value };
      } else if (this.peek().type === 'lparen') {
        // Function call
        this.advance();
        const args: SmtExpr[] = [];
        while (this.peek().type !== 'rparen' && this.peek().type !== 'eof') {
          if (args.length > 0) this.expect('comma');
          args.push(this.parseTernary());
        }
        this.expect('rparen');
        const callee = flattenToString(expr);
        expr = { kind: 'call', callee, args };
      } else {
        break;
      }
    }
    return expr;
  }
}

// ---------------------------------------------------------------------------
// Arrow function parsing
// ---------------------------------------------------------------------------

/**
 * Parse an arrow function source string into SmtExpr.
 */
function parseArrowFunction(source: string): SmtExpr {
  const tokens = tokenize(source);

  // Find the arrow token to split params from body
  let arrowIdx = -1;
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'lparen' || tokens[i].type === 'lbrace') depth++;
    if (tokens[i].type === 'rparen' || tokens[i].type === 'rbrace') depth--;
    if (tokens[i].type === 'arrow' && depth === 0) {
      arrowIdx = i;
      break;
    }
  }

  if (arrowIdx === -1) {
    throw new Error('No arrow found in function source');
  }

  // Parse parameter section to build destructuring map
  const paramTokens = tokens.slice(0, arrowIdx);
  const paramMap = parseParams(paramTokens);

  // Parse body expression
  let bodyTokens = tokens.slice(arrowIdx + 1);

  // If body starts with { ... }, try to extract the return expression
  if (bodyTokens.length > 0 && bodyTokens[0].type === 'lbrace') {
    bodyTokens = extractReturnBody(bodyTokens);
  }

  const parser = new Parser(bodyTokens, paramMap);
  return parser.parse();
}

/**
 * Parse parameter tokens into a map from destructured names to their paths.
 * Examples:
 *   (ctx) => ... → no mapping needed
 *   ({ input, state }) => ... → input → [param0, input], state → [param0, state]
 *   (args, result) => ... → no mapping needed
 */
function parseParams(tokens: Token[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  // Flatten tokens to just relevant content (strip outer parens)
  const inner = stripOuterParens(tokens);

  // Split by commas at depth 0 to find individual params
  const params = splitByComma(inner);

  for (let pi = 0; pi < params.length; pi++) {
    const paramGroup = params[pi];
    if (paramGroup.length === 0) continue;

    // Check for destructuring: { ... }
    if (paramGroup[0].type === 'lbrace') {
      // Destructured param
      const paramName = `__param${pi}__`;
      for (const t of paramGroup) {
        if (t.type === 'ident') {
          map.set(t.value, [paramName, t.value]);
        }
      }
    }
    // Simple param name — no mapping needed, used directly
  }

  return map;
}

function stripOuterParens(tokens: Token[]): Token[] {
  if (tokens.length >= 2 && tokens[0].type === 'lparen') {
    // Find matching rparen
    let depth = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'lparen') depth++;
      if (tokens[i].type === 'rparen') {
        depth--;
        if (depth === 0) {
          return tokens.slice(1, i);
        }
      }
    }
  }
  return tokens;
}

function splitByComma(tokens: Token[]): Token[][] {
  const groups: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;

  for (const t of tokens) {
    if (t.type === 'lbrace' || t.type === 'lparen') depth++;
    if (t.type === 'rbrace' || t.type === 'rparen') depth--;
    if (t.type === 'comma' && depth === 0) {
      groups.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Extract the expression from a block body: { return EXPR; } or { EXPR }
 */
function extractReturnBody(tokens: Token[]): Token[] {
  // Skip opening brace
  const inner = tokens.slice(1);

  // Remove trailing rbrace and eof
  const end = inner.findIndex((t) => t.type === 'rbrace');
  const body = end >= 0 ? inner.slice(0, end) : inner;

  // Skip 'return' keyword if present
  if (
    body.length > 0 &&
    body[0].type === 'ident' &&
    body[0].value === 'return'
  ) {
    return [...body.slice(1), { type: 'eof' as const, value: '' }];
  }

  return [...body, { type: 'eof' as const, value: '' }];
}

/**
 * Flatten an SmtExpr to a dotted string (for call callee names).
 */
function flattenToString(expr: SmtExpr): string {
  if (expr.kind === 'var') {
    return expr.path.length > 0
      ? `${expr.name}.${expr.path.join('.')}`
      : expr.name;
  }
  if (expr.kind === 'prop') {
    return `${flattenToString(expr.obj)}.${expr.prop}`;
  }
  return '<unknown>';
}
