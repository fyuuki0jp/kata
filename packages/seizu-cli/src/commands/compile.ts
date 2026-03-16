import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { CAC } from 'cac';
import type { SmtExpr } from 'seizu/smt';
import { createSolver, proveGraph } from 'seizu/smt';
import { generateObligations, RefinementGraph, specRefId } from 'seizu/spec';
import {
  type GraphArtifact,
  type ManifestArtifact,
  serializeSpec,
  writeArtifacts,
} from '../compile/artifact';
import { extractPredicatesFromSource } from '../compile/ast-extractor';
import { computeDigest } from '../compile/digest';
import { discoverSpecs } from '../compile/discovery';
import { resolveTargets } from '../compile/resolver';
import { ConfigError, loadConfig } from '../config';

interface CompileSpecOptions {
  readonly config: string;
  readonly artifactDir?: string;
  readonly silent?: boolean;
}

interface CompileSpecResult {
  readonly artifactDir: string;
  readonly graphArtifact: GraphArtifact;
  readonly manifestArtifact: ManifestArtifact;
  readonly refuted: number;
}

export function registerCompileCommand(cli: CAC): void {
  cli
    .command(
      'compile',
      'Compile formal specs and run SMT proofs (advanced; verify/doc do this automatically)'
    )
    .option('--config <path>', 'Config file path', {
      default: 'seizu.config.ts',
    })
    .option('--artifact-dir <path>', 'Output directory for artifacts')
    .action(async (options) => {
      try {
        const result = await runSpecCompile({
          config: options.config,
          artifactDir: options.artifactDir,
        });
        if (result.refuted > 0) {
          console.error(`${result.refuted} SMT obligation(s) REFUTED`);
          process.exit(1);
          return;
        }
        process.exit(0);
      } catch (error) {
        if (error instanceof ConfigError) {
          console.error(`Configuration error: ${error.message}`);
          process.exit(2);
        }
        console.error(error);
        process.exit(1);
      }
    });
}

export async function runSpecCompile(
  options: CompileSpecOptions
): Promise<CompileSpecResult> {
  const log = options.silent ? () => undefined : console.log;
  const basePath = process.cwd();
  const { config } = await loadConfig(options.config);
  const formalSpec = config.formalSpec;
  if (!formalSpec) {
    throw new ConfigError('No formalSpec configuration found');
  }

  const artifactDir = resolve(
    basePath,
    options.artifactDir ?? formalSpec.artifactDir ?? '.seizu'
  );

  log('Discovering specs...');
  const discovered = await discoverSpecs(formalSpec.entrypoints, basePath);
  log(`Found ${discovered.length} specs`);

  log('Resolving targets...');
  const targets = resolveTargets(discovered, basePath);

  const graph = new RefinementGraph();
  graph.addAll(discovered.map((d) => d.spec));
  const validation = graph.validate();
  if (!validation.ok) {
    throw new Error(
      `Graph validation failed:\n${validation.error.issues.map((issue) => `  - ${issue}`).join('\n')}`
    );
  }

  const allObligations = discovered.flatMap((d) => generateObligations(d.spec));
  log(`Generated ${allObligations.length} obligations`);

  log('Extracting predicate IRs from source...');
  const predicateIRMap = new Map<string, SmtExpr>();
  const seenFiles = new Set<string>();
  for (const d of discovered) {
    if (seenFiles.has(d.modulePath)) continue;
    seenFiles.add(d.modulePath);

    const tsPath = d.modulePath.replace(/\.js$/, '.ts');
    try {
      const sourceCode = readFileSync(tsPath, 'utf-8');
      const extracted = extractPredicatesFromSource(sourceCode, tsPath);
      for (const pred of extracted) {
        if (pred.ir.kind !== 'unsupported') {
          predicateIRMap.set(
            `${pred.specId}:${pred.clauseKind}:${pred.clauseId}`,
            pred.ir
          );
        }
      }
      if (extracted.length > 0) {
        const supported = extracted.filter(
          (p) => p.ir.kind !== 'unsupported'
        ).length;
        log(
          `  ${tsPath}: ${extracted.length} predicates found, ${supported} supported`
        );
      }
    } catch {
      // Source file not readable, will fall back to Function.toString()
    }
  }
  log(`AST extraction: ${predicateIRMap.size} predicate IR(s) available`);

  log('Running SMT proofs...');
  const solver = await createSolver();
  const smtResults = await proveGraph(graph, solver, predicateIRMap);
  const proved = smtResults.filter((r) => r.status === 'PROVED').length;
  const refuted = smtResults.filter((r) => r.status === 'REFUTED').length;
  const unknown = smtResults.filter((r) => r.status === 'UNKNOWN').length;
  log(`SMT: ${proved} proved, ${refuted} refuted, ${unknown} unknown`);

  const smtResultMap = new Map(smtResults.map((r) => [r.obligationId, r]));
  const resolvedObligations = allObligations.map((obl) => {
    const smtResult = smtResultMap.get(obl.id);
    if (smtResult) {
      return { ...obl, status: smtResult.status } as const;
    }
    return { ...obl, status: 'PENDING' as const };
  });

  const entrypointFiles = [...new Set(discovered.map((d) => d.modulePath))];
  const digest = computeDigest(entrypointFiles);

  const graphArtifact: GraphArtifact = {
    artifactVersion: '3.0',
    artifactDigest: digest,
    specs: discovered.map((d) => serializeSpec(d.spec)),
    obligations: resolvedObligations,
    edges: discovered.flatMap((d) =>
      d.spec.dependsOn.map((dep) => ({
        from: d.spec.id,
        to: specRefId(dep),
      }))
    ),
    smtResults,
    diagnostics: [],
  };
  const manifestArtifact: ManifestArtifact = {
    artifactVersion: '3.0',
    artifactDigest: digest,
    entrypoints: entrypointFiles.map((p) => ({
      path: relative(basePath, p),
      digest: computeDigest([p]),
    })),
    targets,
    specs: discovered.map((d) => {
      // Compute local index: position of this spec among specs from the same module
      const localIndex = discovered
        .filter((other) => other.modulePath === d.modulePath)
        .findIndex((other) => other.spec.id === d.spec.id);
      return {
        specId: d.spec.id,
        kind: d.spec.kind,
        modulePath: relative(basePath, d.modulePath),
        exportName: 'specs',
        index: localIndex,
        specHash: '',
      };
    }),
  };

  writeArtifacts(artifactDir, graphArtifact, manifestArtifact);
  log(`Artifacts written to ${artifactDir}/`);

  return {
    artifactDir,
    graphArtifact,
    manifestArtifact,
    refuted,
  };
}
