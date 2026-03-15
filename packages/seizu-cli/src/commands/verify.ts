import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CAC } from 'cac';
import type { Result } from 'seizu';
import type { SmtResult } from 'seizu/smt';
import type { SpecVerifyResult as PropagationSpecVerifyResult } from 'seizu/spec';
import { propagateEvidence, RefinementGraph } from 'seizu/spec';
import type { SpecVerifyResult as PbtSpecVerifyResult } from 'seizu/verify';
import { mergeEvidence, verify, verifyLaw, verifyUsecase } from 'seizu/verify';
import {
  type GraphArtifact,
  type ManifestArtifact,
  writeGraphArtifact,
} from '../compile/artifact';
import { ConfigError, loadConfig } from '../config';
import { json } from '../verify/reporters/json';
import { replay } from '../verify/reporters/replay';
import { summary } from '../verify/reporters/summary';
import { runSpecCompile } from './compile';

const reporters = { summary, json, replay } as const;
type ReporterName = keyof typeof reporters;

// ---- Spec-mode types (inline for spike) ----

interface SpecVerifyEntry {
  readonly specId: string;
  readonly kind: 'law' | 'usecase';
}

interface RunSpecVerifyOptions {
  readonly config: string;
  readonly artifactDir: string;
  readonly runs: string;
  readonly seed?: string;
  readonly silent?: boolean;
}

interface RunSpecVerifyResult {
  readonly graphArtifact: GraphArtifact;
  readonly exitCode: number;
}

export function registerVerifyCommand(cli: CAC): void {
  cli
    .command('verify [...contracts]', 'Verify contracts with PBT')
    .option('--reporter <type>', 'Reporter: summary, json, replay', {
      default: 'summary',
    })
    .option('--runs <count>', 'Number of PBT runs', { default: 100 })
    .option('--config <path>', 'Config file path', {
      default: 'seizu.config.ts',
    })
    .option('--seed <seed>', 'Random seed for reproduction')
    .option('--path <path>', 'Counterexample path for reproduction')
    .option('--specs', 'Verify formal specs')
    .option('--artifact-dir <path>', 'Artifact directory', {
      default: '.seizu',
    })
    .action(async (contracts: string[], options) => {
      try {
        // ---- Spec-based verification mode ----
        if (options.specs) {
          const result = await runSpecVerify(options);
          process.exit(result.exitCode);
          return;
        }

        // ---- Legacy contract-based verification (unchanged) ----
        const { config } = await loadConfig(options.config);
        const verifyConfig = config.verify;

        let entries = verifyConfig.contracts;
        if (contracts.length > 0) {
          entries = entries.filter((e) => contracts.includes(e.contract.name));
          if (entries.length === 0) {
            console.error(`No contracts matched: ${contracts.join(', ')}`);
            process.exit(2);
            return;
          }
        }

        const reporterName = options.reporter as ReporterName;
        const reporter = reporters[reporterName];
        if (!reporter) {
          console.error(`Unknown reporter: ${options.reporter}`);
          process.exit(2);
          return;
        }

        const result = verify(entries, {
          numRuns: Number(options.runs),
          seed: options.seed !== undefined ? Number(options.seed) : undefined,
          path: options.path,
        });

        console.log(reporter(result));

        process.exit(result.success ? 0 : 1);
      } catch (error) {
        if (error instanceof ConfigError) {
          console.error(`Configuration error: ${error.message}`);
          process.exit(2);
        }
        throw error;
      }
    });
}

// ---- Spec verification ----

export async function runSpecVerify(
  options: RunSpecVerifyOptions
): Promise<RunSpecVerifyResult> {
  const { graphArtifact, manifestArtifact, artifactDir } = await runSpecCompile(
    {
      config: options.config,
      artifactDir: options.artifactDir,
      silent: options.silent,
    }
  );
  const basePath = process.cwd();
  const manifest = manifestArtifact as ManifestArtifact;

  // 1. Read spec verify entries from config
  const { config } = await loadConfig(options.config);
  const configAny = config as unknown as Record<string, unknown>;
  const verifySection = configAny.verify as Record<string, unknown> | undefined;
  const specEntries: readonly SpecVerifyEntry[] =
    verifySection && Array.isArray(verifySection.specs)
      ? (verifySection.specs as readonly SpecVerifyEntry[])
      : [];

  // Determine which specs to verify
  let entriesToVerify: readonly SpecVerifyEntry[];
  if (specEntries.length > 0) {
    entriesToVerify = specEntries;
  } else {
    // Fall back: auto-verify law and usecase specs (usecase without setup will use a no-op harness)
    const autoEntries: SpecVerifyEntry[] = graphArtifact.specs
      .filter((s) => s.kind === 'law' || s.kind === 'usecase')
      .map((s) => ({ specId: s.id, kind: s.kind as 'law' | 'usecase' }));

    if (autoEntries.length === 0) {
      if (!options.silent) {
        console.log('No specs to verify.');
      }
      return { graphArtifact, exitCode: 0 };
    }

    entriesToVerify = autoEntries;
  }

  // 2. Run PBT verification for each spec
  const smtResults: readonly SmtResult[] = graphArtifact.smtResults ?? [];
  const pbtResults: PbtSpecVerifyResult[] = [];
  const numRuns = Number(options.runs);
  const seed = options.seed !== undefined ? Number(options.seed) : undefined;

  for (const entry of entriesToVerify) {
    const resolved = await resolveSpecFromManifest(
      entry.specId,
      manifest,
      basePath
    );
    if (!resolved) continue;

    const { specObj, mod } = resolved;

    if (entry.kind === 'law') {
      try {
        // Import the target function
        const targetModulePath = resolve(basePath, specObj.target.module);
        const targetMod = (await import(
          pathToFileURL(targetModulePath).href
        )) as Record<string, unknown>;
        const targetFn = targetMod[specObj.target.export];

        if (typeof targetFn !== 'function') {
          console.error(
            `  ${entry.specId} — target function "${specObj.target.export}" not found in "${specObj.target.module}", skipping`
          );
          continue;
        }

        const pbtResult = verifyLaw(
          specObj as unknown as Parameters<typeof verifyLaw>[0],
          {
            targetFn: (...args: unknown[]) => targetFn(...args),
            numRuns,
            seed,
          }
        );
        pbtResults.push(pbtResult);
      } catch (e) {
        console.error(
          `  ${entry.specId} — error during verification: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    } else if (entry.kind === 'usecase') {
      try {
        // Import the target function
        const targetModulePath = resolve(basePath, specObj.target.module);
        const targetMod = (await import(
          pathToFileURL(targetModulePath).href
        )) as Record<string, unknown>;
        const targetFn = targetMod[specObj.target.export] as
          | ((deps: unknown, input: unknown) => Promise<unknown>)
          | undefined;

        if (typeof targetFn !== 'function') {
          console.error(
            `  ${entry.specId} — target function "${specObj.target.export}" not found, skipping`
          );
          continue;
        }

        // Try to find an inputArbitrary export in the module
        let inputArb: unknown;
        try {
          inputArb = mod.inputArbitrary ?? mod[`${specObj.id}_inputArbitrary`];
        } catch {
          // ignore
        }

        if (!inputArb) {
          console.error(
            `  ${entry.specId} — no inputArbitrary found, skipping usecase PBT`
          );
          continue;
        }

        // Look for setup/snapshot exports in the spec module
        const setupFn = (mod[`${specObj.id}_setup`] ??
          mod.setup ??
          (async () => ({ deps: {}, cleanup: undefined }))) as () => Promise<{
          deps: unknown;
          cleanup?: () => Promise<void>;
        }>;
        const snapshotFn = (mod[`${specObj.id}_snapshot`] ??
          mod.snapshot ??
          (async () => ({}))) as (deps: unknown) => Promise<unknown>;
        const observeFn = (mod[`${specObj.id}_observe`] ?? mod.observe) as
          | ((
              ctx: Parameters<typeof verifyUsecase>[1]['observe'] extends
                | ((ctx: infer T) => Promise<unknown>)
                | undefined
                ? T
                : never
            ) => Promise<unknown>)
          | undefined;

        const ucResult = await verifyUsecase(
          specObj as unknown as Parameters<typeof verifyUsecase>[0],
          {
            setup: setupFn,
            inputArbitrary: inputArb as Parameters<
              typeof verifyUsecase
            >[1]['inputArbitrary'],
            snapshot: snapshotFn,
            observe: observeFn,
            targetFn: targetFn as (
              deps: unknown,
              input: unknown
            ) => Promise<Result<unknown, unknown>>,
            numRuns,
            seed,
          }
        );
        pbtResults.push(ucResult);
      } catch (e) {
        console.error(
          `  ${entry.specId} — error during verification: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  // 3. Merge SMT + PBT evidence for each spec
  const mergedResults: PbtSpecVerifyResult[] = [];
  for (const pbt of pbtResults) {
    const specSmtResults = smtResults.filter((r) =>
      r.obligationId.startsWith(`${pbt.specId}:`)
    );
    if (specSmtResults.length > 0) {
      mergedResults.push(mergeEvidence(specSmtResults, pbt));
    } else {
      mergedResults.push(pbt);
    }
  }

  // 4. Build refinement graph and propagate evidence
  const graph = new RefinementGraph();
  // Add minimal spec nodes for propagation
  for (const spec of graphArtifact.specs) {
    graph.add({
      kind: spec.kind as 'requirement' | 'usecase' | 'law',
      id: spec.id,
      name: spec.name,
      dependsOn: spec.dependsOn.map((dep) =>
        dep.mode === 'trace' ? { id: dep.id, mode: 'trace' } : dep.id
      ),
    } as Parameters<typeof graph.add>[0]);
  }

  const propagationInput = new Map<string, PropagationSpecVerifyResult>();
  for (const result of mergedResults) {
    propagationInput.set(result.specId, {
      specId: result.specId,
      obligations: result.obligations.map((o) => ({
        obligationId: o.obligationId,
        status: o.status,
      })),
    });
  }

  // Add requirement specs (and any specs not in PBT results) with their SMT obligations
  for (const spec of graphArtifact.specs) {
    if (!propagationInput.has(spec.id)) {
      const specSmtResults = smtResults.filter((r) =>
        r.obligationId.startsWith(`${spec.id}:`)
      );
      const specObligations = (graphArtifact.obligations ?? [])
        .filter((o) => o.specId === spec.id)
        .map((o) => {
          const smt = specSmtResults.find((r) => r.obligationId === o.id);
          return {
            obligationId: o.id,
            status: smt?.status ?? o.status ?? 'UNKNOWN',
          };
        });
      if (specObligations.length > 0) {
        propagationInput.set(spec.id, {
          specId: spec.id,
          obligations: specObligations,
        });
      }
    }
  }

  const propagated = propagateEvidence(graph, propagationInput);
  const resolvedInput = resolveDependencyObligations(
    graphArtifact,
    propagationInput,
    propagated
  );
  const finalizedGraph = finalizeGraphArtifact(graphArtifact, resolvedInput);
  writeGraphArtifact(artifactDir, finalizedGraph);

  const report = reportSpecResults(
    finalizedGraph,
    mergedResults,
    resolvedInput,
    propagated
  );
  if (!options.silent) {
    console.log(report.output);
  }
  return {
    graphArtifact: finalizedGraph,
    exitCode: report.exitCode,
  };
}

/** Resolve a spec object from the manifest by looking up the module, importing, and finding by id. */
async function resolveSpecFromManifest(
  specId: string,
  manifest: ManifestArtifact,
  basePath: string
): Promise<{
  specObj: { id: string; target: { module: string; export: string } } & Record<
    string,
    unknown
  >;
  mod: Record<string, unknown>;
} | null> {
  const manifestEntry = manifest.specs.find((s) => s.specId === specId);
  if (!manifestEntry) {
    console.error(`  ${specId} — manifest entry not found, skipping`);
    return null;
  }

  const modulePath = resolve(basePath, manifestEntry.modulePath);
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(modulePath).href)) as Record<
      string,
      unknown
    >;
  } catch (e) {
    console.error(
      `  ${specId} — error importing module: ${e instanceof Error ? e.message : String(e)}`
    );
    return null;
  }
  const exportedSpecs = mod[manifestEntry.exportName];

  let spec: unknown;
  if (Array.isArray(exportedSpecs)) {
    spec =
      exportedSpecs.find(
        (s: unknown) =>
          s &&
          typeof s === 'object' &&
          'id' in s &&
          (s as { id: string }).id === specId
      ) ?? exportedSpecs[manifestEntry.index];
  } else {
    spec = exportedSpecs;
  }

  if (!spec || typeof spec !== 'object') {
    console.error(`  ${specId} — could not resolve spec object, skipping`);
    return null;
  }

  return {
    specObj: spec as {
      id: string;
      target: { module: string; export: string };
    } & Record<string, unknown>,
    mod,
  };
}

function resolveDependencyObligations(
  graphArtifact: GraphArtifact,
  propagationInput: ReadonlyMap<string, PropagationSpecVerifyResult>,
  propagated: ReadonlyMap<
    string,
    { specId: string; status: string; invalidDeps: readonly string[] }
  >
): ReadonlyMap<string, PropagationSpecVerifyResult> {
  const obligationMap = new Map(
    (graphArtifact.obligations ?? []).map((obligation) => [
      obligation.id,
      obligation,
    ])
  );
  const resolved = new Map<string, PropagationSpecVerifyResult>();

  for (const [specId, result] of propagationInput) {
    resolved.set(specId, {
      ...result,
      obligations: result.obligations.map((obligation) => {
        const artifactObligation = obligationMap.get(obligation.obligationId);
        if (artifactObligation?.kind !== 'dep') {
          return obligation;
        }

        const depEvidence = propagated.get(artifactObligation.clauseId);
        if (!depEvidence) {
          return { ...obligation, status: 'UNKNOWN' };
        }

        switch (depEvidence.status) {
          case 'valid':
          case 'assumed':
            return { ...obligation, status: 'PROVED' };
          case 'unknown':
            return { ...obligation, status: 'UNKNOWN' };
          default:
            return { ...obligation, status: 'REFUTED' };
        }
      }),
    });
  }

  return resolved;
}

function finalizeGraphArtifact(
  graphArtifact: GraphArtifact,
  propagationInput: ReadonlyMap<string, PropagationSpecVerifyResult>
): GraphArtifact {
  const obligationStatuses = new Map<string, string>();

  for (const result of propagationInput.values()) {
    for (const obligation of result.obligations) {
      obligationStatuses.set(obligation.obligationId, obligation.status);
    }
  }

  return {
    ...graphArtifact,
    obligations: graphArtifact.obligations.map((obligation) => ({
      ...obligation,
      status:
        obligationStatuses.get(obligation.id) ?? obligation.status ?? 'UNKNOWN',
    })),
  };
}

function reportSpecResults(
  graphArtifact: GraphArtifact,
  pbtResults: readonly PbtSpecVerifyResult[],
  propagationInput: ReadonlyMap<string, PropagationSpecVerifyResult>,
  propagated: ReadonlyMap<
    string,
    { specId: string; status: string; invalidDeps: readonly string[] }
  >
): { output: string; exitCode: number } {
  // Build a map of SMT reasons for UNKNOWN obligations
  const smtReasonMap = new Map<string, string>();
  for (const smt of (graphArtifact.smtResults ?? []) as readonly SmtResult[]) {
    if (smt.status === 'UNKNOWN' && smt.reason) {
      smtReasonMap.set(smt.obligationId, smt.reason);
    }
  }
  const lines: string[] = ['seizu-verify --specs', ''];

  let totalSpecs = 0;
  let totalObligations = 0;
  let proved = 0;
  let tested = 0;
  let refuted = 0;
  let unknown = 0;
  let assumed = 0;

  // Build a map of PBT results for quick lookup
  const resultMap = new Map<string, PbtSpecVerifyResult>();
  for (const r of pbtResults) {
    resultMap.set(r.specId, r);
  }

  // Show ALL specs from the graph (including requirements)
  for (const spec of graphArtifact.specs) {
    totalSpecs++;
    const pbtResult = resultMap.get(spec.id);
    const propResult = propagated.get(spec.id);
    const propInput = propagationInput.get(spec.id);

    const kindLabel =
      spec.kind === 'requirement'
        ? 'REQ'
        : spec.kind === 'usecase'
          ? 'UC'
          : spec.kind === 'law'
            ? 'LAW'
            : spec.kind.toUpperCase();

    lines.push(`  [${kindLabel}] ${spec.name} (${spec.id})`);

    const obligations = pbtResult?.obligations ?? propInput?.obligations;
    if (obligations) {
      const counts = renderObligations(obligations, smtReasonMap, lines);
      totalObligations += counts.total;
      proved += counts.proved;
      tested += counts.tested;
      refuted += counts.refuted;
      unknown += counts.unknown;
      assumed += counts.assumed;
    } else {
      // No obligations at all
      lines.push(`    (no obligations)`);
    }

    if (propResult) {
      lines.push(
        `    propagation: ${propResult.status}${propResult.invalidDeps.length > 0 ? ` (invalid deps: ${propResult.invalidDeps.join(', ')})` : ''}`
      );
    }

    lines.push('');
  }

  lines.push(
    `  ${totalSpecs} specs, ${totalObligations} obligations: ` +
      `${proved} proved, ${tested} tested, ${refuted} refuted, ${unknown} unknown, ${assumed} assumed`
  );

  return {
    output: lines.join('\n'),
    exitCode: refuted > 0 ? 1 : 0,
  };
}

/** Render obligation lines and return status counts. */
function renderObligations(
  obligations: readonly { obligationId: string; status: string }[],
  smtReasonMap: ReadonlyMap<string, string>,
  lines: string[]
): {
  total: number;
  proved: number;
  tested: number;
  refuted: number;
  unknown: number;
  assumed: number;
} {
  let proved = 0;
  let tested = 0;
  let refuted = 0;
  let unknown = 0;
  let assumed = 0;

  for (const ob of obligations) {
    const status = ob.status;
    const icon =
      status === 'PROVED' || status === 'TESTED'
        ? '\u2713'
        : status === 'REFUTED'
          ? '\u2717'
          : '?';
    const parts = ob.obligationId.split(':');
    const kindAndClause = parts.slice(1).join(':');
    const reason = smtReasonMap.get(ob.obligationId);
    const reasonSuffix = status === 'UNKNOWN' && reason ? ` (${reason})` : '';
    lines.push(`    ${icon} ${kindAndClause} — ${status}${reasonSuffix}`);
    switch (status) {
      case 'PROVED':
        proved++;
        break;
      case 'TESTED':
        tested++;
        break;
      case 'REFUTED':
        refuted++;
        break;
      case 'ASSUMED':
        assumed++;
        break;
      default:
        unknown++;
        break;
    }
  }

  return {
    total: obligations.length,
    proved,
    tested,
    refuted,
    unknown,
    assumed,
  };
}
