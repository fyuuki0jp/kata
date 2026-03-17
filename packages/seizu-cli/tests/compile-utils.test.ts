import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { computeDigest } from '../src/compile/digest';
import type { DiscoveredSpec } from '../src/compile/discovery';
import { discoverSpecs } from '../src/compile/discovery';
import { resolveTargets } from '../src/compile/resolver';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('compile utilities', () => {
  test('computeDigest is stable across different base paths', () => {
    const dirA = makeTempDir('seizu-digest-a-');
    const dirB = makeTempDir('seizu-digest-b-');
    const relPath = 'src/spec.ts';
    mkdirSync(join(dirA, 'src'), { recursive: true });
    mkdirSync(join(dirB, 'src'), { recursive: true });
    const contents = "export const value = 'ok';\n";
    writeFileSync(join(dirA, relPath), contents, 'utf-8');
    writeFileSync(join(dirB, relPath), contents, 'utf-8');

    const digestA = computeDigest([relPath], dirA);
    const digestB = computeDigest([relPath], dirB);

    expect(digestA).toBe(digestB);
  });

  test('resolveTargets falls back to the spec parent directory', () => {
    const projectRoot = makeTempDir('seizu-resolver-');
    const specDir = join(projectRoot, 'src', 'spec');
    const domainDir = join(projectRoot, 'src', 'domain');
    mkdirSync(specDir, { recursive: true });
    mkdirSync(domainDir, { recursive: true });
    const targetModulePath = join(domainDir, 'handler.ts');
    writeFileSync(targetModulePath, 'export const handler = () => {};\n');

    const specPath = join(specDir, 'domain.spec.ts');
    writeFileSync(specPath, 'export const placeholder = true;\n');

    const discovered: DiscoveredSpec = {
      spec: {
        kind: 'law',
        id: 'LAW-Test',
        name: 'resolver test',
        target: { module: 'src/domain/handler', export: 'handler' },
        generators: {},
        laws: [],
        dependsOn: [],
      },
      modulePath: specPath,
      index: 0,
    };

    const targets = resolveTargets([discovered], specDir);

    expect(targets).toHaveLength(1);
    expect(targets[0].modulePath.startsWith('/')).toBe(false);
    expect(targets[0].modulePath.replace(/\\/g, '/')).toBe(
      '../domain/handler.ts'
    );
  });

  test('resolveTargets skips requirements and missing targets', () => {
    const basePath = makeTempDir('seizu-resolver-skip-');
    const specs: DiscoveredSpec[] = [
      {
        spec: {
          kind: 'requirement',
          id: 'REQ-1',
          name: 'req',
          dependsOn: [],
          actors: [],
          goal: '',
          given: [],
          success: [],
          failure: [],
          forbidden: [],
        },
        modulePath: join(basePath, 'req.spec.ts'),
        index: 0,
      },
      {
        spec: {
          kind: 'law',
          id: 'LAW-1',
          name: 'law',
          target: undefined as unknown as { module: string; export: string },
          generators: {},
          laws: [],
          dependsOn: [],
        },
        modulePath: join(basePath, 'law.spec.ts'),
        index: 0,
      },
    ];

    const targets = resolveTargets(specs, basePath);

    expect(targets).toHaveLength(0);
  });

  test('resolveTargets returns unresolved path when no candidates exist', () => {
    const basePath = makeTempDir('seizu-resolver-miss-');
    const specDir = join(basePath, 'src', 'spec');
    mkdirSync(specDir, { recursive: true });

    const spec: DiscoveredSpec = {
      spec: {
        kind: 'usecase',
        id: 'UC-Missing',
        name: 'missing target',
        target: { module: 'nowhere/missing', export: 'noop' },
        classifyError: () => 'never',
        given: [],
        ensures: [],
        invariants: [],
        errors: [],
        effects: [],
        dependsOn: [],
      },
      modulePath: join(specDir, 'missing.spec.ts'),
      index: 0,
    };

    const targets = resolveTargets([spec], basePath);

    expect(targets[0]?.modulePath.replace(/\\/g, '/')).toBe('nowhere/missing');
  });

  test('discoverSpecs ignores non-array exports and invalid entries', async () => {
    const projectRoot = makeTempDir('seizu-discovery-invalid-');
    const specDir = join(projectRoot, 'src', 'spec');
    mkdirSync(specDir, { recursive: true });

    const notArrayFile = join(specDir, 'not-array.mjs');
    writeFileSync(notArrayFile, 'export const specs = {};\n', 'utf-8');

    const invalidEntryFile = join(specDir, 'invalid-entry.mjs');
    writeFileSync(
      invalidEntryFile,
      [
        'export const specs = [',
        '  123,',
        '  { kind: "law", id: "LAW-Valid", name: "valid", generators: {}, laws: [], dependsOn: [], target: { module: "./noop", export: "noop" } },',
        '];',
        '',
      ].join('\n'),
      'utf-8'
    );

    const discovered = await discoverSpecs(
      ['src/spec/not-array.mjs', 'src/spec/invalid-entry.mjs'],
      projectRoot
    );

    expect(discovered.map((d) => d.spec.id)).toEqual(['LAW-Valid']);
  });

  test('discoverSpecs resolves ** globs and imports specs', async () => {
    const projectRoot = makeTempDir('seizu-discovery-');
    const specDir = join(projectRoot, 'src', 'spec', 'nested');
    mkdirSync(specDir, { recursive: true });
    const specFile = join(specDir, 'law.spec.mjs');
    writeFileSync(
      specFile,
      [
        'export const specs = [',
        '  {',
        "    kind: 'law',",
        "    id: 'LAW-Example',",
        "    name: 'example',",
        "    target: { module: './noop', export: 'noop' },",
        '    generators: {},',
        '    laws: [],',
        '    dependsOn: [],',
        '  },',
        '];',
      ].join('\n'),
      'utf-8'
    );

    const discovered = await discoverSpecs(
      ['src/spec/**/*.spec.mjs'],
      projectRoot
    );

    expect(discovered.map((d) => d.spec.id)).toContain('LAW-Example');
    expect(discovered[0]?.modulePath).toBe(specFile);
  });

  test('discoverSpecs loads direct file paths without globs', async () => {
    const projectRoot = makeTempDir('seizu-discovery-direct-');
    const specDir = join(projectRoot, 'src', 'spec');
    mkdirSync(specDir, { recursive: true });
    const specFile = join(specDir, 'direct.spec.mjs');
    writeFileSync(
      specFile,
      [
        'export const specs = [',
        '  { kind: "law", id: "LAW-Direct", name: "direct", generators: {}, laws: [], dependsOn: [], target: { module: "./noop", export: "noop" } },',
        '];',
        '',
      ].join('\n'),
      'utf-8'
    );

    const discovered = await discoverSpecs([specFile], projectRoot);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.spec.id).toBe('LAW-Direct');
  });

  test('resolveTargets returns early when target includes extension', () => {
    const projectRoot = makeTempDir('seizu-resolver-ext-');
    const specDir = join(projectRoot, 'src', 'spec');
    mkdirSync(specDir, { recursive: true });
    const targetDir = join(projectRoot, 'src', 'service');
    mkdirSync(targetDir, { recursive: true });
    const targetPath = join(targetDir, 'service.ts');
    writeFileSync(targetPath, 'export const service = () => {};\n');

    const discovered: DiscoveredSpec = {
      spec: {
        kind: 'usecase',
        id: 'UC-Service',
        name: 'service',
        target: { module: 'src/service/service.ts', export: 'service' },
        classifyError: () => 'never',
        given: [],
        ensures: [],
        invariants: [],
        errors: [],
        effects: [],
        dependsOn: [],
      },
      modulePath: join(specDir, 'service.spec.ts'),
      index: 0,
    };

    const targets = resolveTargets([discovered], projectRoot);

    expect(targets[0]?.modulePath.replace(/\\/g, '/')).toBe(
      'src/service/service.ts'
    );
  });
});
