import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CAC } from 'cac';
import type { Result } from 'seizu';
import type { SmtResult } from 'seizu/smt';
import type { SpecVerifyResult as PropagationSpecVerifyResult } from 'seizu/spec';
import { propagateEvidence, RefinementGraph } from 'seizu/spec';
import type { SpecVerifyResult as PbtSpecVerifyResult } from 'seizu/verify';
import { mergeEvidence, verify, verifyLaw, verifyUsecase } from 'seizu/verify';
import type { GraphArtifact, ManifestArtifact } from '../compile/artifact';
import { ConfigError, loadConfig } from '../config';
import { json } from '../verify/reporters/json';
import { replay } from '../verify/reporters/replay';
import { summary } from '../verify/reporters/summary';

const reporters = { summary, json, replay } as const;
type ReporterName = keyof typeof reporters;

// ---- Spec-mode types (inline for spike) ----

interface SpecVerifyEntry {
  readonly specId: string;
  readonly kind: 'law' | 'usecase';
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
    .option('--specs', 'Verify formal specs (requires compiled artifacts)')
    .option('--artifact-dir <path>', 'Artifact directory', {
      default: '.seizu',
    })
    .action(async (contracts: string[], options) => {
      try {
        // ---- Spec-based verification mode ----
        if (options.specs) {
          await runSpecVerify(options);
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

async function runSpecVerify(options: {
  config: string;
  artifactDir: string;
  runs: string;
  seed?: string;
}): Promise<void> {
  const basePath = process.cwd();
  const artifactDir = resolve(basePath, options.artifactDir);

  // 1. Read compiled artifacts
  let graphArtifact: GraphArtifact;
  let manifest: ManifestArtifact;
  try {
    graphArtifact = JSON.parse(
      readFileSync(resolve(artifactDir, 'graph.json'), 'utf-8')
    ) as GraphArtifact;
    manifest = JSON.parse(
      readFileSync(resolve(artifactDir, 'manifest.json'), 'utf-8')
    ) as ManifestArtifact;
  } catch {
    console.error(
      'Failed to read compiled artifacts. Run `seizu compile` first.'
    );
    process.exit(1);
    return;
  }

  // 2. Stale check
  if (!manifest.artifactDigest) {
    console.error(
      'Artifact digest missing – artifacts may be stale. Run `seizu compile` first.'
    );
    process.exit(1);
    return;
  }

  // 3. Read spec verify entries from config
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
      console.log('No specs to verify.');
      process.exit(0);
      return;
    }

    entriesToVerify = autoEntries;
  }

  // 4. Run PBT verification for each spec
  const smtResults: readonly SmtResult[] = graphArtifact.smtResults ?? [];
  const pbtResults: PbtSpecVerifyResult[] = [];
  const numRuns = Number(options.runs);
  const seed = options.seed !== undefined ? Number(options.seed) : undefined;

  for (const entry of entriesToVerify) {
    if (entry.kind === 'law') {
      // Find the spec's module path from manifest
      const manifestEntry = manifest.specs.find(
        (s) => s.specId === entry.specId
      );
      if (!manifestEntry) {
        console.error(`  ${entry.specId} — manifest entry not found, skipping`);
        continue;
      }

      // Import the spec module to get the law spec object
      const modulePath = resolve(basePath, manifestEntry.modulePath);
      try {
        const mod = (await import(pathToFileURL(modulePath).href)) as Record<
          string,
          unknown
        >;
        const exportedSpecs = mod[manifestEntry.exportName];

        // Find the spec in the exported array or object
        let lawSpec: unknown;
        if (Array.isArray(exportedSpecs)) {
          lawSpec = exportedSpecs[manifestEntry.index];
        } else {
          lawSpec = exportedSpecs;
        }

        if (!lawSpec || typeof lawSpec !== 'object') {
          console.error(
            `  ${entry.specId} — could not resolve spec object, skipping`
          );
          continue;
        }

        const specObj = lawSpec as {
          id: string;
          name: string;
          target: { module: string; export: string };
          generators: Record<string, unknown>;
          laws: readonly {
            id: string;
            description: string;
            predicate: (
              args: Record<string, unknown>,
              result: unknown
            ) => boolean;
          }[];
        };

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
          specObj as Parameters<typeof verifyLaw>[0],
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
      // Find the spec's module path from manifest
      const manifestEntry = manifest.specs.find(
        (s) => s.specId === entry.specId
      );
      if (!manifestEntry) {
        console.error(`  ${entry.specId} — manifest entry not found, skipping`);
        continue;
      }

      const modulePath = resolve(basePath, manifestEntry.modulePath);
      try {
        const mod = (await import(pathToFileURL(modulePath).href)) as Record<
          string,
          unknown
        >;
        const exportedSpecs = mod[manifestEntry.exportName];

        let ucSpec: unknown;
        if (Array.isArray(exportedSpecs)) {
          ucSpec = exportedSpecs[manifestEntry.index];
        } else {
          ucSpec = exportedSpecs;
        }

        if (!ucSpec || typeof ucSpec !== 'object') {
          console.error(
            `  ${entry.specId} — could not resolve spec object, skipping`
          );
          continue;
        }

        const specObj = ucSpec as {
          id: string;
          name: string;
          kind: string;
          target: { module: string; export: string };
          classifyError: (error: unknown) => string;
          given: readonly {
            id: string;
            predicate: (ctx: unknown) => boolean;
          }[];
          ensures: readonly {
            id: string;
            predicate: (ctx: unknown) => boolean;
          }[];
          invariants: readonly {
            id: string;
            predicate: (ctx: unknown) => boolean;
          }[];
          errors: readonly {
            id: string;
            tag: string;
            predicate?: (ctx: unknown) => boolean;
          }[];
          effects: readonly {
            id: string;
            facet: string;
            predicate: (observed: unknown, ctx: unknown) => boolean;
          }[];
        };

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

        // Build inputArbitrary from spec's generators or use a basic one
        // For auto-verify mode, look for a generators export or use the spec's given to build test data
        let inputArb: unknown;
        try {
          // Try to find an inputArbitrary export in the module
          inputArb = mod.inputArbitrary ?? mod[`${specObj.id}_inputArbitrary`];
        } catch {
          // ignore
        }

        if (!inputArb) {
          // Skip usecase without inputArbitrary
          console.error(
            `  ${entry.specId} — no inputArbitrary found, skipping usecase PBT`
          );
          continue;
        }

        // Run UsecaseSpec verification with verifyUsecase
        const ucResult = await verifyUsecase(
          specObj as Parameters<typeof verifyUsecase>[0],
          {
            setup: async () => ({ deps: {}, cleanup: undefined }),
            inputArbitrary: inputArb as Parameters<
              typeof verifyUsecase
            >[1]['inputArbitrary'],
            snapshot: async () => ({ graphSize: 0 }),
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

  // 5. Merge SMT + PBT evidence for each spec
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

  // 6. Build refinement graph and propagate evidence
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

  // 7. Report results — show ALL specs (including requirements)
  reportSpecResults(
    graphArtifact,
    mergedResults,
    resolveDependencyObligations(graphArtifact, propagationInput, propagated),
    propagated
  );
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

function reportSpecResults(
  graphArtifact: GraphArtifact,
  pbtResults: readonly PbtSpecVerifyResult[],
  propagationInput: ReadonlyMap<string, PropagationSpecVerifyResult>,
  propagated: ReadonlyMap<
    string,
    { specId: string; status: string; invalidDeps: readonly string[] }
  >
): void {
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

    if (pbtResult) {
      // Show merged obligations from PBT run
      for (const ob of pbtResult.obligations) {
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
        const reasonSuffix =
          status === 'UNKNOWN' && reason ? ` (${reason})` : '';
        lines.push(`    ${icon} ${kindAndClause} — ${status}${reasonSuffix}`);
        totalObligations++;
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
    } else if (propInput) {
      // No PBT but has propagation input (e.g. requirements with SMT obligations)
      for (const ob of propInput.obligations) {
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
        const reasonSuffix =
          status === 'UNKNOWN' && reason ? ` (${reason})` : '';
        lines.push(`    ${icon} ${kindAndClause} — ${status}${reasonSuffix}`);
        totalObligations++;
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

  console.log(lines.join('\n'));

  process.exit(refuted > 0 ? 1 : 0);
}
