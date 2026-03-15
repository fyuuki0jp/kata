import type { SmtBinOp, SmtExpr } from 'seizu/smt';
import ts from 'typescript';

export interface ExtractedPredicate {
  readonly specId: string;
  readonly clauseKind: string; // 'given' | 'ensure' | 'law' | 'invariant' | 'errorClause' | 'effect'
  readonly clauseId: string;
  readonly ir: SmtExpr;
}

/**
 * Extract all predicate IRs from a spec source file using the TypeScript Compiler API.
 *
 * Walks the AST looking for clause call expressions (given, ensure, law, invariant,
 * errorClause, effect) and converts their predicate arrow functions to SmtExpr IR.
 */
export function extractPredicatesFromSource(
  sourceCode: string,
  filePath: string
): ExtractedPredicate[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );
  const results: ExtractedPredicate[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fnName = node.expression.text;
      if (
        [
          'given',
          'ensure',
          'invariant',
          'law',
          'errorClause',
          'effect',
        ].includes(fnName)
      ) {
        const extracted = extractClausePredicate(node, fnName, sourceFile);
        if (extracted) results.push(extracted);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/**
 * Extract predicate from a clause call expression and convert to SmtExpr IR.
 */
function extractClausePredicate(
  call: ts.CallExpression,
  clauseKind: string,
  sourceFile: ts.SourceFile
): ExtractedPredicate | null {
  // All clause factories: first arg is always the id string
  const idArg = call.arguments[0];
  if (!idArg || !ts.isStringLiteral(idArg)) return null;
  const clauseId = idArg.text;

  // Predicate position depends on clause kind:
  // given(id, desc, pred)         -> [2]
  // ensure(id, desc, pred)        -> [2]
  // invariant(id, desc, pred)     -> [2]
  // law(id, desc, pred)           -> [2]
  // errorClause(id, tag, desc, pred?) -> [3]
  // effect(id, facet, desc, pred) -> [3]
  const predIdx = ['errorClause', 'effect'].includes(clauseKind) ? 3 : 2;
  const predArg = call.arguments[predIdx];
  if (!predArg) return null;

  if (ts.isArrowFunction(predArg) || ts.isFunctionExpression(predArg)) {
    let bodyExpr: ts.Expression | null = null;

    if (ts.isArrowFunction(predArg) && !ts.isBlock(predArg.body)) {
      // Expression body: (x) => expr
      bodyExpr = predArg.body;
    } else {
      // Block body: (x) => { ... return expr; }
      const body = ts.isArrowFunction(predArg) ? predArg.body : predArg.body;
      if (ts.isBlock(body)) {
        bodyExpr = extractReturnExpression(body);
      }
    }

    if (!bodyExpr) {
      return {
        specId: findEnclosingSpecId(call, sourceFile) ?? 'unknown',
        clauseKind,
        clauseId,
        ir: {
          kind: 'unsupported',
          reason: 'Could not extract body expression from predicate',
        },
      };
    }

    // Build parameter destructuring map
    const paramMap = buildParamMap(predArg.parameters);

    const ir = tsExpressionToSmtExpr(bodyExpr, paramMap, sourceFile);

    const specId = findEnclosingSpecId(call, sourceFile);

    return { specId: specId ?? 'unknown', clauseKind, clauseId, ir };
  }

  return null;
}

/**
 * Extract the return expression from a block body.
 */
function extractReturnExpression(block: ts.Block): ts.Expression | null {
  for (const statement of block.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      return statement.expression;
    }
  }
  return null;
}

/**
 * Build a map from destructured parameter names to their path.
 *
 * For `({ input, state })`, produces:
 *   input -> ['__param0__', 'input']
 *   state -> ['__param0__', 'state']
 *
 * For `(ctx)`, produces nothing (ctx is used directly).
 */
function buildParamMap(
  params: ts.NodeArray<ts.ParameterDeclaration>
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    if (ts.isObjectBindingPattern(param.name)) {
      const paramBase = `__param${i}__`;
      for (const element of param.name.elements) {
        if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
          const propName = element.propertyName
            ? ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : element.name.text
            : element.name.text;
          map.set(element.name.text, [paramBase, propName]);
        }
      }
    }
    // Simple params (identifiers) don't need mapping
  }

  return map;
}

/**
 * Convert a TypeScript AST Expression node to SmtExpr IR.
 */
export function tsExpressionToSmtExpr(
  node: ts.Expression,
  paramMap: Map<string, string[]>,
  sourceFile: ts.SourceFile
): SmtExpr {
  // Parenthesized expression: (expr) -> unwrap
  if (ts.isParenthesizedExpression(node)) {
    return tsExpressionToSmtExpr(node.expression, paramMap, sourceFile);
  }

  // BinaryExpression: a op b
  if (ts.isBinaryExpression(node)) {
    const op = mapTsBinaryOp(node.operatorToken.kind);
    if (!op) {
      return {
        kind: 'unsupported',
        reason: `Unsupported operator: ${ts.SyntaxKind[node.operatorToken.kind]}`,
      };
    }
    return {
      kind: 'binop',
      op,
      left: tsExpressionToSmtExpr(node.left, paramMap, sourceFile),
      right: tsExpressionToSmtExpr(node.right, paramMap, sourceFile),
    };
  }

  // ConditionalExpression: a ? b : c
  if (ts.isConditionalExpression(node)) {
    return {
      kind: 'ternary',
      cond: tsExpressionToSmtExpr(node.condition, paramMap, sourceFile),
      thenExpr: tsExpressionToSmtExpr(node.whenTrue, paramMap, sourceFile),
      else: tsExpressionToSmtExpr(node.whenFalse, paramMap, sourceFile),
    };
  }

  // PropertyAccessExpression: a.b
  if (ts.isPropertyAccessExpression(node)) {
    const prop = node.name.text;
    // .length special handling
    if (prop === 'length') {
      return {
        kind: 'length',
        obj: tsExpressionToSmtExpr(node.expression, paramMap, sourceFile),
      };
    }
    return {
      kind: 'prop',
      obj: tsExpressionToSmtExpr(node.expression, paramMap, sourceFile),
      prop,
    };
  }

  // CallExpression: check for method calls like .every(), .some()
  if (ts.isCallExpression(node)) {
    if (ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text;
      const obj = node.expression.expression;

      if (methodName === 'every' && node.arguments.length === 1) {
        const callback = node.arguments[0];
        if (ts.isArrowFunction(callback) && callback.parameters.length >= 1) {
          const paramName = callback.parameters[0].name.getText(sourceFile);
          const body = ts.isBlock(callback.body) ? null : callback.body;
          if (body) {
            // Build a new paramMap for the callback scope (inheriting outer scope)
            const innerParamMap = new Map(paramMap);
            return {
              kind: 'forall',
              varName: paramName,
              domain: tsExpressionToSmtExpr(obj, paramMap, sourceFile),
              body: tsExpressionToSmtExpr(body, innerParamMap, sourceFile),
            };
          }
        }
      }

      if (methodName === 'some' && node.arguments.length === 1) {
        const callback = node.arguments[0];
        if (ts.isArrowFunction(callback) && callback.parameters.length >= 1) {
          const paramName = callback.parameters[0].name.getText(sourceFile);
          const body = ts.isBlock(callback.body) ? null : callback.body;
          if (body) {
            const innerParamMap = new Map(paramMap);
            return {
              kind: 'exists',
              varName: paramName,
              domain: tsExpressionToSmtExpr(obj, paramMap, sourceFile),
              body: tsExpressionToSmtExpr(body, innerParamMap, sourceFile),
            };
          }
        }
      }

      if (methodName === 'includes' && node.arguments.length === 1) {
        return {
          kind: 'call',
          callee: 'Collection.includes',
          args: [
            tsExpressionToSmtExpr(obj, paramMap, sourceFile),
            tsExpressionToSmtExpr(node.arguments[0], paramMap, sourceFile),
          ],
        };
      }

      if (methodName === 'startsWith' && node.arguments.length === 1) {
        return {
          kind: 'call',
          callee: 'String.startsWith',
          args: [
            tsExpressionToSmtExpr(obj, paramMap, sourceFile),
            tsExpressionToSmtExpr(node.arguments[0], paramMap, sourceFile),
          ],
        };
      }

      if (methodName === 'get' && node.arguments.length === 1) {
        return {
          kind: 'call',
          callee: node.expression.getText(sourceFile),
          args: node.arguments.map((arg) =>
            tsExpressionToSmtExpr(arg, paramMap, sourceFile)
          ),
        };
      }

      return {
        kind: 'unsupported',
        reason: `Method call .${methodName}() not supported in SMT encoding`,
      };
    }

    // Non-method call expression
    return {
      kind: 'unsupported',
      reason: `Call expression not supported in SMT encoding`,
    };
  }

  // NumericLiteral
  if (ts.isNumericLiteral(node)) {
    return { kind: 'literal', value: Number(node.text) };
  }

  // StringLiteral -> string literal (supported for equality comparison)
  if (ts.isStringLiteral(node)) {
    return { kind: 'literal', value: node.text };
  }

  // TrueKeyword / FalseKeyword
  if (node.kind === ts.SyntaxKind.TrueKeyword)
    return { kind: 'literal', value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword)
    return { kind: 'literal', value: false };

  // Identifier
  if (ts.isIdentifier(node)) {
    const name = node.text;
    // Check if this is a destructured parameter
    if (paramMap.has(name)) {
      const basePath = paramMap.get(name);
      if (!basePath) {
        return { kind: 'unsupported', reason: `Unknown param: ${name}` };
      }
      return { kind: 'var', name: basePath[0], path: basePath.slice(1) };
    }
    return { kind: 'var', name, path: [] };
  }

  // PrefixUnaryExpression: !x, -x
  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.ExclamationToken) {
      return {
        kind: 'unop',
        op: '!',
        expr: tsExpressionToSmtExpr(node.operand, paramMap, sourceFile),
      };
    }
    if (node.operator === ts.SyntaxKind.MinusToken) {
      const operand = tsExpressionToSmtExpr(node.operand, paramMap, sourceFile);
      // Optimize: negate literal directly
      if (operand.kind === 'literal' && typeof operand.value === 'number') {
        return { kind: 'literal', value: -operand.value };
      }
      return { kind: 'unop', op: '-', expr: operand };
    }
  }

  // TypeAssertion / AsExpression: treat as passthrough
  if (ts.isAsExpression(node)) {
    return tsExpressionToSmtExpr(node.expression, paramMap, sourceFile);
  }
  if (ts.isTypeAssertionExpression(node)) {
    return tsExpressionToSmtExpr(node.expression, paramMap, sourceFile);
  }

  // NonNullExpression: a! -> treat as a
  if (ts.isNonNullExpression(node)) {
    return tsExpressionToSmtExpr(node.expression, paramMap, sourceFile);
  }

  return {
    kind: 'unsupported',
    reason: `Unsupported TS syntax: ${ts.SyntaxKind[node.kind]}`,
  };
}

/**
 * Map TypeScript binary operator to SmtBinOp.
 */
function mapTsBinaryOp(kind: ts.SyntaxKind): SmtBinOp | null {
  switch (kind) {
    case ts.SyntaxKind.PlusToken:
      return '+';
    case ts.SyntaxKind.MinusToken:
      return '-';
    case ts.SyntaxKind.AsteriskToken:
      return '*';
    case ts.SyntaxKind.SlashToken:
      return '/';
    case ts.SyntaxKind.PercentToken:
      return '%';
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return '===';
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return '!==';
    case ts.SyntaxKind.LessThanToken:
      return '<';
    case ts.SyntaxKind.GreaterThanToken:
      return '>';
    case ts.SyntaxKind.LessThanEqualsToken:
      return '<=';
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return '>=';
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return '&&';
    case ts.SyntaxKind.BarBarToken:
      return '||';
    default:
      return null;
  }
}

/**
 * Walk up the AST to find the enclosing spec builder call (lawSpec, usecaseSpec, etc.)
 * and extract the `id` property from its argument object.
 */
function findEnclosingSpecId(
  node: ts.Node,
  _sourceFile: ts.SourceFile
): string | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      const calleeName = current.expression.text;
      if (['lawSpec', 'usecaseSpec', 'requirementSpec'].includes(calleeName)) {
        // First argument should be an object literal with `id` property
        const configArg = current.arguments[0];
        if (configArg && ts.isObjectLiteralExpression(configArg)) {
          for (const prop of configArg.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === 'id' &&
              ts.isStringLiteral(prop.initializer)
            ) {
              return prop.initializer.text;
            }
          }
        }
      }
    }
    current = current.parent;
  }
  return null;
}
