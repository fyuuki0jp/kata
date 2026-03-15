import { describe, expect, test } from 'vitest';
import { extractPredicatesFromSource } from '../src/compile/ast-extractor';

describe('AST extractor', () => {
  test('preserves Map#get property access as symbolic call-based IR', () => {
    const source = `
      import { lawSpec, law } from 'seizu/spec';

      export const specs = [
        lawSpec({
          id: 'LAW-Test',
          name: 'test',
          target: { module: '.', export: 'noop' },
          generators: {},
          laws: [
            law('status-check', 'status check', () => {
              const evidence = new Map();
              return evidence.get('LEAF')?.status === 'refuted';
            }),
          ],
          dependsOn: [],
        }),
      ];
    `;

    const extracted = extractPredicatesFromSource(source, 'virtual-spec.ts');
    expect(extracted).toHaveLength(1);

    const predicate = extracted[0]?.ir;
    expect(predicate?.kind).toBe('binop');

    if (predicate?.kind === 'binop' && predicate.left.kind === 'prop') {
      expect(predicate.left.obj.kind).toBe('call');
      if (predicate.left.obj.kind === 'call') {
        expect(predicate.left.obj.callee).toBe('evidence.get');
      }
    }
  });

  test('extracts includes and startsWith as supported call IR', () => {
    const source = `
      import { lawSpec, law } from 'seizu/spec';

      export const specs = [
        lawSpec({
          id: 'LAW-Test',
          name: 'test',
          target: { module: '.', export: 'noop' },
          generators: {},
          laws: [
            law('membership', 'membership', ({ values, prefix }) => {
              return values.includes('X') && prefix.startsWith('LAW-');
            }),
          ],
          dependsOn: [],
        }),
      ];
    `;

    const extracted = extractPredicatesFromSource(source, 'virtual-spec.ts');
    const predicate = extracted[0]?.ir;
    expect(predicate?.kind).toBe('binop');

    if (predicate?.kind === 'binop') {
      expect(predicate.left.kind).toBe('call');
      expect(predicate.right.kind).toBe('call');

      if (predicate.left.kind === 'call') {
        expect(predicate.left.callee).toBe('Collection.includes');
      }
      if (predicate.right.kind === 'call') {
        expect(predicate.right.callee).toBe('String.startsWith');
      }
    }
  });
});
