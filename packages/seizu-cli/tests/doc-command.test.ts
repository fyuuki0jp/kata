import type { CAC } from 'cac';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  MockConfigError,
  loadConfigMock,
  getMessagesMock,
  discoverSourceFilesMock,
  resolveGlobsMock,
  createProgramFromFilesMock,
  isExcludedMock,
  renderMarkdownMock,
  docGenerateMock,
  runSpecVerifyMock,
  existsSyncMock,
  mkdirSyncMock,
  readFileSyncMock,
  writeFileSyncMock,
} = vi.hoisted(() => {
  class MockConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ConfigError';
    }
  }

  return {
    MockConfigError,
    loadConfigMock: vi.fn(),
    getMessagesMock: vi.fn(),
    discoverSourceFilesMock: vi.fn(),
    resolveGlobsMock: vi.fn(),
    createProgramFromFilesMock: vi.fn(),
    isExcludedMock: vi.fn(() => false),
    renderMarkdownMock: vi.fn(),
    docGenerateMock: vi.fn(),
    runSpecVerifyMock: vi.fn(),
    existsSyncMock: vi.fn(),
    mkdirSyncMock: vi.fn(),
    readFileSyncMock: vi.fn(),
    writeFileSyncMock: vi.fn(),
  };
});

class ExitError extends Error {
  readonly code: number | undefined;

  constructor(code: number | undefined) {
    super(`process.exit(${String(code)})`);
    this.code = code;
  }
}

vi.mock('../src/config', () => ({
  ConfigError: MockConfigError,
  loadConfig: loadConfigMock,
}));

vi.mock('../src/doc/i18n/index', () => ({
  getMessages: getMessagesMock,
}));

vi.mock('../src/doc/parser/source-discovery', () => ({
  discoverSourceFiles: discoverSourceFilesMock,
}));

vi.mock('../src/doc/parser/source-resolver', () => ({
  createProgramFromFiles: createProgramFromFilesMock,
  resolveGlobs: resolveGlobsMock,
  isExcluded: isExcludedMock,
}));

vi.mock('../src/doc/renderer/markdown', () => ({
  renderMarkdown: renderMarkdownMock,
}));

vi.mock('../src/domain/pipeline', () => ({
  docGenerate: docGenerateMock,
}));

vi.mock('../src/commands/verify', () => ({
  runSpecVerify: runSpecVerifyMock,
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
  readFileSync: readFileSyncMock,
  writeFileSync: writeFileSyncMock,
}));

import { registerDocCommand } from '../src/commands/doc';

type DocAction = (
  contracts: string[],
  options: Record<string, unknown>
) => Promise<void>;

interface RegisteredOption {
  readonly name: string;
  readonly description: string;
}

function createCliHarness(): {
  readonly cli: CAC;
  readonly action: DocAction;
  readonly options: readonly RegisteredOption[];
} {
  let action: DocAction | undefined;
  const options: RegisteredOption[] = [];

  const commandChain = {
    option: (name: string, description: string) => {
      options.push({ name, description });
      return commandChain;
    },
    action: (fn: DocAction) => {
      action = fn;
      return commandChain;
    },
  };

  const cli = {
    command: () => commandChain,
  } as unknown as CAC;

  registerDocCommand(cli);

  if (!action) {
    throw new Error('Action was not registered.');
  }

  return { cli, action, options };
}

function makeOptions(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    config: 'seizu.config.ts',
    output: undefined,
    title: undefined,
    locale: undefined,
    coverage: false,
    flow: undefined,
    check: false,
    flowDebugOutput: undefined,
    entrypoint: undefined,
    sourceScope: undefined,
    stdout: false,
    artifactDir: '.seizu',
    ...overrides,
  };
}

function makeFlow(ownerKind: 'contract' | 'scenario', ownerName: string) {
  return {
    ownerKind,
    ownerName,
    graph: { nodes: [], edges: [] },
    mermaid: 'graph TD',
    hash: `${ownerKind}-${ownerName}`,
    summary: {
      stepCount: 0,
      branchCount: 0,
      errorPathCount: 0,
      unsupportedCount: 0,
    },
  };
}

describe('registerDocCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(process, 'cwd').mockReturnValue('/workspace');
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ExitError(code);
    }) as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
    discoverSourceFilesMock.mockReturnValue({
      files: [],
      contractFiles: [],
      scenarioFiles: [],
    });
    resolveGlobsMock.mockReturnValue([]);
  });

  test('registers source scope and explicit defaults in help text', () => {
    const { options } = createCliHarness();

    expect(options).toEqual(
      expect.arrayContaining([
        {
          name: '--output <path>',
          description:
            'Output file path (overrides config; default: docs/contracts.md)',
        },
        {
          name: '--entrypoint <path>',
          description:
            'Discovery seed file/dir/glob (comma-separated or repeatable)',
        },
        {
          name: '--source-scope <mode>',
          description:
            'Source scope: auto (config+discovery), repo (discovery only), globs (config only)',
        },
      ])
    );
  });

  test('uses config locale when --locale is omitted', async () => {
    loadConfigMock.mockResolvedValue({
      config: {
        title: 'Doc',
        contracts: ['contracts/**/*.ts'],
        locale: 'ja',
        verify: { contracts: [] },
      },
    });
    getMessagesMock.mockReturnValue({ locale: 'ja' });
    resolveGlobsMock.mockReturnValue([]);
    renderMarkdownMock.mockReturnValue({ ok: true, value: '# generated' });

    const { action } = createCliHarness();

    await expect(
      action([], makeOptions({ stdout: true }))
    ).rejects.toMatchObject({ code: 0 });

    expect(getMessagesMock).toHaveBeenCalledWith('ja');
    expect(process.stdout.write).toHaveBeenCalledWith('# generated');
    expect(docGenerateMock).not.toHaveBeenCalled();
  });

  test('runs spec verification before rendering spec markdown', async () => {
    runSpecVerifyMock.mockResolvedValue({
      graphArtifact: {
        artifactVersion: '3.0',
        artifactDigest: 'digest',
        specs: [
          {
            id: 'UC-CreateTransfer',
            kind: 'usecase',
            name: 'Create transfer',
            dependsOn: [],
          },
        ],
        obligations: [
          {
            id: 'UC-CreateTransfer:ensure:balance-preserved',
            specId: 'UC-CreateTransfer',
            kind: 'ensure',
            clauseId: 'balance-preserved',
            status: 'TESTED',
          },
        ],
        edges: [],
        smtResults: [],
        diagnostics: [],
      },
      exitCode: 0,
    });

    const { action } = createCliHarness();

    await expect(
      action([], makeOptions({ specs: true, stdout: true }))
    ).rejects.toMatchObject({ code: 0 });

    expect(runSpecVerifyMock).toHaveBeenCalledWith({
      config: 'seizu.config.ts',
      artifactDir: '.seizu',
      runs: '100',
      silent: true,
    });
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('TESTED')
    );
    expect(docGenerateMock).not.toHaveBeenCalled();
  });

  test('runs pipeline, writes flow debug json, and writes markdown file', async () => {
    loadConfigMock.mockResolvedValue({
      config: {
        title: 'Doc',
        contracts: ['contracts/**/*.ts'],
        verify: { contracts: [] },
      },
    });
    getMessagesMock.mockReturnValue({ locale: 'en' });
    resolveGlobsMock
      .mockReturnValueOnce(['/workspace/contracts/cart.ts'])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    createProgramFromFilesMock.mockReturnValue({
      getSourceFile: vi.fn(() => ({}) as object),
    });
    docGenerateMock.mockReturnValue({
      ok: true,
      value: {
        markdown: '# from pipeline',
        linked: [{ contract: { flow: makeFlow('contract', 'b') } }],
        linkedScenarios: [{ scenario: { flow: makeFlow('scenario', 'a') } }],
      },
    });

    const { action } = createCliHarness();

    await expect(
      action(
        ['cart.create'],
        makeOptions({
          output: 'docs/out.md',
          flowDebugOutput: 'tmp/flow-debug.json',
        })
      )
    ).rejects.toMatchObject({ code: 0 });

    expect(docGenerateMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Doc' }),
      expect.objectContaining({
        coverageEnabled: false,
        filterIds: new Set(['cart.create']),
      })
    );

    expect(writeFileSyncMock).toHaveBeenCalledTimes(2);
    expect(
      writeFileSyncMock.mock.calls.some((call) =>
        String(call[0]).includes('tmp/flow-debug.json')
      )
    ).toBe(true);
    expect(
      writeFileSyncMock.mock.calls.some(
        (call) =>
          String(call[0]).includes('docs/out.md') &&
          call[1] === '# from pipeline'
      )
    ).toBe(true);
  });

  test('exits with code 1 when pipeline fails', async () => {
    loadConfigMock.mockResolvedValue({
      config: {
        title: 'Doc',
        contracts: ['contracts/**/*.ts'],
        verify: { contracts: [] },
      },
    });
    getMessagesMock.mockReturnValue({ locale: 'en' });
    resolveGlobsMock
      .mockReturnValueOnce(['/workspace/contracts/cart.ts'])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    createProgramFromFilesMock.mockReturnValue({
      getSourceFile: vi.fn(() => ({}) as object),
    });
    docGenerateMock.mockReturnValue({
      ok: false,
      error: { stepIndex: 2, contractName: 'doc.render' },
    });

    const { action } = createCliHarness();

    await expect(action([], makeOptions())).rejects.toMatchObject({ code: 1 });
    expect(console.error).toHaveBeenCalledWith(
      'Pipeline failed at step 2: doc.render'
    );
  });

  test('supports check mode for missing/outdated/up-to-date output', async () => {
    loadConfigMock.mockResolvedValue({
      config: {
        title: 'Doc',
        contracts: ['contracts/**/*.ts'],
        verify: { contracts: [] },
      },
    });
    getMessagesMock.mockReturnValue({ locale: 'en' });
    resolveGlobsMock.mockReturnValue([]);
    renderMarkdownMock.mockReturnValue({ ok: true, value: '# current' });

    const { action } = createCliHarness();

    existsSyncMock.mockReturnValueOnce(false);
    await expect(
      action([], makeOptions({ check: true, output: 'docs/contracts.md' }))
    ).rejects.toMatchObject({ code: 1 });
    expect(console.error).toHaveBeenCalledWith(
      'Documentation file not found: /workspace/docs/contracts.md'
    );

    existsSyncMock.mockReturnValueOnce(true);
    readFileSyncMock.mockReturnValueOnce('# old');
    await expect(
      action([], makeOptions({ check: true, output: 'docs/contracts.md' }))
    ).rejects.toMatchObject({ code: 1 });
    expect(console.error).toHaveBeenCalledWith(
      'Documentation is out of date: /workspace/docs/contracts.md\nRun: seizu doc --config seizu.config.ts'
    );

    existsSyncMock.mockReturnValueOnce(true);
    readFileSyncMock.mockReturnValueOnce('# current');
    await expect(
      action([], makeOptions({ check: true, output: 'docs/contracts.md' }))
    ).rejects.toMatchObject({ code: 0 });
    expect(console.log).toHaveBeenCalledWith(
      'Documentation is up to date: /workspace/docs/contracts.md'
    );
  });

  test('uses repo discovery when config globs do not match', async () => {
    loadConfigMock.mockResolvedValue({
      config: {
        title: 'Doc',
        contracts: ['contracts/**/*.ts'],
        verify: { contracts: [] },
      },
    });
    getMessagesMock.mockReturnValue({ locale: 'en' });
    discoverSourceFilesMock.mockReturnValue({
      files: [
        {
          path: '/workspace/src/discovered.ts',
          hasDefine: true,
          hasScenario: true,
        },
      ],
      contractFiles: ['/workspace/src/discovered.ts'],
      scenarioFiles: ['/workspace/src/discovered.ts'],
    });
    createProgramFromFilesMock.mockReturnValue({
      getSourceFile: vi.fn(() => ({}) as object),
    });
    docGenerateMock.mockReturnValue({
      ok: true,
      value: {
        markdown: '# discovered',
        linked: [],
        linkedScenarios: [],
      },
    });

    const { action } = createCliHarness();

    await expect(
      action([], makeOptions({ stdout: true, entrypoint: undefined }))
    ).rejects.toMatchObject({ code: 0 });

    expect(discoverSourceFilesMock).toHaveBeenCalledWith({
      basePath: '/workspace',
      entrypoints: undefined,
    });
    expect(createProgramFromFilesMock).toHaveBeenCalledWith(
      ['/workspace/src/discovered.ts'],
      undefined
    );
  });

  test('uses --source-scope repo for repository-wide discovery', async () => {
    loadConfigMock.mockResolvedValue({
      config: {
        title: 'Doc',
        contracts: ['contracts/**/*.ts'],
        verify: { contracts: [] },
      },
    });
    getMessagesMock.mockReturnValue({ locale: 'en' });
    discoverSourceFilesMock.mockReturnValue({
      files: [
        {
          path: '/workspace/src/repo-discovered.ts',
          hasDefine: true,
          hasScenario: false,
        },
      ],
      contractFiles: ['/workspace/src/repo-discovered.ts'],
      scenarioFiles: [],
    });
    createProgramFromFilesMock.mockReturnValue({
      getSourceFile: vi.fn(() => ({}) as object),
    });
    docGenerateMock.mockReturnValue({
      ok: true,
      value: {
        markdown: '# repo scope',
        linked: [],
        linkedScenarios: [],
      },
    });

    const { action } = createCliHarness();

    await expect(
      action([], makeOptions({ stdout: true, sourceScope: 'repo' }))
    ).rejects.toMatchObject({ code: 0 });

    expect(discoverSourceFilesMock).toHaveBeenCalledWith({
      basePath: '/workspace',
      entrypoints: undefined,
    });
    expect(resolveGlobsMock).not.toHaveBeenCalled();
    expect(createProgramFromFilesMock).toHaveBeenCalledWith(
      ['/workspace/src/repo-discovered.ts'],
      undefined
    );
  });

  test('uses --source-scope globs to stay compatible with config globs', async () => {
    loadConfigMock.mockResolvedValue({
      config: {
        title: 'Doc',
        contracts: ['contracts/**/*.ts'],
        scenarios: ['scenarios/**/*.ts'],
        tests: ['tests/**/*.test.ts'],
        verify: { contracts: [] },
      },
    });
    getMessagesMock.mockReturnValue({ locale: 'en' });
    resolveGlobsMock
      .mockReturnValueOnce(['/workspace/contracts/cart.ts'])
      .mockReturnValueOnce(['/workspace/scenarios/cart.scenario.ts'])
      .mockReturnValueOnce(['/workspace/tests/cart.test.ts']);
    createProgramFromFilesMock.mockReturnValue({
      getSourceFile: vi.fn(() => ({}) as object),
    });
    docGenerateMock.mockReturnValue({
      ok: true,
      value: {
        markdown: '# globs scope',
        linked: [],
        linkedScenarios: [],
      },
    });

    const { action } = createCliHarness();

    await expect(
      action([], makeOptions({ stdout: true, sourceScope: 'globs' }))
    ).rejects.toMatchObject({ code: 0 });

    expect(discoverSourceFilesMock).not.toHaveBeenCalled();
    expect(resolveGlobsMock).toHaveBeenNthCalledWith(
      1,
      ['contracts/**/*.ts'],
      '/workspace'
    );
    expect(resolveGlobsMock).toHaveBeenNthCalledWith(
      2,
      ['scenarios/**/*.ts'],
      '/workspace'
    );
    expect(resolveGlobsMock).toHaveBeenNthCalledWith(
      3,
      ['tests/**/*.test.ts'],
      '/workspace'
    );
    expect(createProgramFromFilesMock).toHaveBeenCalledWith(
      [
        '/workspace/contracts/cart.ts',
        '/workspace/scenarios/cart.scenario.ts',
        '/workspace/tests/cart.test.ts',
      ],
      undefined
    );
  });

  test('uses --entrypoint as discovery seeds', async () => {
    loadConfigMock.mockResolvedValue({
      config: {
        title: 'Doc',
        contracts: ['contracts/**/*.ts'],
        verify: { contracts: [] },
      },
    });
    getMessagesMock.mockReturnValue({ locale: 'en' });
    discoverSourceFilesMock.mockReturnValue({
      files: [
        {
          path: '/workspace/src/domain/pipeline.ts',
          hasDefine: true,
          hasScenario: false,
        },
      ],
      contractFiles: ['/workspace/src/domain/pipeline.ts'],
      scenarioFiles: [],
    });
    createProgramFromFilesMock.mockReturnValue({
      getSourceFile: vi.fn(() => ({}) as object),
    });
    docGenerateMock.mockReturnValue({
      ok: true,
      value: {
        markdown: '# entrypoint',
        linked: [],
        linkedScenarios: [],
      },
    });

    const { action } = createCliHarness();

    await expect(
      action(
        [],
        makeOptions({
          stdout: true,
          entrypoint: 'src/domain/pipeline.ts, src/domain/report.ts',
        })
      )
    ).rejects.toMatchObject({ code: 0 });

    expect(discoverSourceFilesMock).toHaveBeenCalledWith({
      basePath: '/workspace',
      entrypoints: ['src/domain/pipeline.ts', 'src/domain/report.ts'],
    });
    expect(resolveGlobsMock).not.toHaveBeenCalled();
    expect(createProgramFromFilesMock).toHaveBeenCalledWith(
      ['/workspace/src/domain/pipeline.ts'],
      undefined
    );
  });

  test('handles ConfigError with exit code 2', async () => {
    loadConfigMock.mockRejectedValue(new MockConfigError('invalid config'));

    const { action } = createCliHarness();

    await expect(action([], makeOptions())).rejects.toMatchObject({ code: 2 });
    expect(console.error).toHaveBeenCalledWith(
      'Configuration error: invalid config'
    );
  });

  test('filters excluded files from resolved sources', async () => {
    loadConfigMock.mockResolvedValue({
      config: {
        title: 'Doc',
        contracts: ['src/**/*.ts'],
        exclude: ['tests/fixtures/**'],
        verify: { contracts: [] },
      },
    });
    getMessagesMock.mockReturnValue({ locale: 'en' });
    resolveGlobsMock.mockReturnValueOnce([
      '/workspace/src/contract.ts',
      '/workspace/tests/fixtures/cart-contracts.ts',
    ]);
    resolveGlobsMock.mockReturnValue([]);
    isExcludedMock.mockImplementation((filePath: string) =>
      filePath.includes('tests/fixtures/')
    );
    createProgramFromFilesMock.mockReturnValue({
      getSourceFile: vi.fn(() => ({}) as object),
    });
    docGenerateMock.mockReturnValue({
      ok: true,
      value: { markdown: '# filtered', linked: [], linkedScenarios: [] },
    });

    const { action } = createCliHarness();

    await expect(
      action([], makeOptions({ stdout: true }))
    ).rejects.toMatchObject({ code: 0 });

    expect(isExcludedMock).toHaveBeenCalled();
    expect(createProgramFromFilesMock).toHaveBeenCalledWith(
      ['/workspace/src/contract.ts'],
      undefined
    );
  });
});
