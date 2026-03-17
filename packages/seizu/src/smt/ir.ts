/**
 * SMT Expression Intermediate Representation.
 * Predicate functions are parsed to this IR, then encoded to SMT-LIB.
 */
export type SmtExpr =
  | {
      readonly kind: 'var';
      readonly name: string;
      readonly path: readonly string[];
    }
  | { readonly kind: 'literal'; readonly value: number | boolean | string }
  | {
      readonly kind: 'binop';
      readonly op: SmtBinOp;
      readonly left: SmtExpr;
      readonly right: SmtExpr;
    }
  | { readonly kind: 'unop'; readonly op: SmtUnOp; readonly expr: SmtExpr }
  | {
      readonly kind: 'ternary';
      readonly cond: SmtExpr;
      readonly thenExpr: SmtExpr;
      readonly else: SmtExpr;
    }
  | { readonly kind: 'prop'; readonly obj: SmtExpr; readonly prop: string }
  | {
      readonly kind: 'call';
      readonly callee: string;
      readonly args: readonly SmtExpr[];
    }
  | {
      readonly kind: 'forall';
      readonly varName: string;
      readonly domain: SmtExpr;
      readonly body: SmtExpr;
    }
  | {
      readonly kind: 'exists';
      readonly varName: string;
      readonly domain: SmtExpr;
      readonly body: SmtExpr;
    }
  | { readonly kind: 'length'; readonly obj: SmtExpr }
  | { readonly kind: 'unsupported'; readonly reason: string };

export type SmtBinOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '==='
  | '!=='
  | '<'
  | '>'
  | '<='
  | '>='
  | '&&'
  | '||';

export type SmtUnOp = '!' | '-';

export type SmtSort = 'Int' | 'Bool' | 'Real' | 'String';

export interface SmtVar {
  readonly name: string;
  readonly sort: SmtSort;
}

/** Result of SMT solving */
export interface SmtResult {
  readonly obligationId: string;
  readonly status: 'PROVED' | 'REFUTED' | 'UNKNOWN';
  readonly encoding?: string;
  readonly counterexample?: Record<string, unknown>;
  readonly reason?: string;
}
