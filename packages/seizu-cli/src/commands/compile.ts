import { readFileSync } from 'node:fs';
import type { CAC } from 'cac';
import type { SmtExpr } from 'seizu/smt';
import { createSolver, proveGraph } from 'seizu/smt';
import { generateObligations, RefinementGraph, specRefId } from 'seizu/spec';
import { serializeSpec, writeArtifacts } from '../compile/artifact';
import { extractPredicatesFromSource } from '../compile/ast-extractor';
import { computeDigest } from '../compile/digest';
import { discoverSpecs } from '../compile/discovery';
import { resolveTargets } from '../compile/resolver';
import { ConfigError, loadConfig } from '../config';

export function registerCompileCommand(cli: CAC): void {
  cli
    .command('compile', 'Compile formal specs and run SMT proofs')
    .option('--config <path>', 'Config file path', {
      default: 'seizu.config.ts',
    })
    .option('--artifact-dir <path>', 'Output directory for artifacts')
    .action(async (options) => {
      try {
        const { config } = await loadConfig(options.config);
        const formalSpec = config.formalSpec;
        if (!formalSpec) {
          console.error('No formalSpec configuration found');
          process.exit(2);
        }

        const basePath = process.cwd();
        const artifactDir =
          options.artifactDir ?? formalSpec.artifactDir ?? '.seizu';

        // 1. Discovery
        console.log('Discovering specs...');
        const discovered = await discoverSpecs(
          formalSpec.entrypoints,
          basePath
        );
        console.log(`Found ${discovered.length} specs`);

        // 2. Resolution
        console.log('Resolving targets...');
        const targets = resolveTargets(discovered, basePath);

        // 3. Build graph
        const graph = new RefinementGraph();
        graph.addAll(discovered.map((d) => d.spec));
        const validation = graph.validate();
        if (!validation.ok) {
          console.error('Graph validation failed:');
          for (const issue of validation.error.issues) {
            console.error(`  - ${issue}`);
          }
          process.exit(1);
        }

        // 4. Generate obligations
        const allObligations = discovered.flatMap((d) =>
          generateObligations(d.spec)
        );
        console.log(`Generated ${allObligations.length} obligations`);

        // 5. Extract predicate IRs from source files using TS Compiler API
        console.log('Extracting predicate IRs from source...');
        const predicateIRMap = new Map<string, SmtExpr>();
        const seenFiles = new Set<string>();
        for (const d of discovered) {
          if (seenFiles.has(d.modulePath)) continue;
          seenFiles.add(d.modulePath);

          // Read the source file (.ts) — the modulePath may be a .js, so try .ts first
          const tsPath = d.modulePath.replace(/\.js$/, '.ts');
          try {
            const sourceCode = readFileSync(tsPath, 'utf-8');
            const extracted = extractPredicatesFromSource(sourceCode, tsPath);
            for (const pred of extracted) {
              if (pred.ir.kind !== 'unsupported') {
                predicateIRMap.set(pred.clauseId, pred.ir);
              }
            }
            if (extracted.length > 0) {
              const supported = extracted.filter(
                (p) => p.ir.kind !== 'unsupported'
              ).length;
              console.log(
                `  ${tsPath}: ${extracted.length} predicates found, ${supported} supported`
              );
            }
          } catch {
            // Source file not readable, will fall back to Function.toString()
          }
        }
        console.log(
          `AST extraction: ${predicateIRMap.size} predicate IR(s) available`
        );

        // 6. Run SMT proofs
        console.log('Running SMT proofs...');
        const solver = await createSolver();
        const smtResults = await proveGraph(graph, solver, predicateIRMap);
        const proved = smtResults.filter((r) => r.status === 'PROVED').length;
        const refuted = smtResults.filter((r) => r.status === 'REFUTED').length;
        const unknown = smtResults.filter((r) => r.status === 'UNKNOWN').length;
        console.log(
          `SMT: ${proved} proved, ${refuted} refuted, ${unknown} unknown`
        );

        // 7. Reflect SMT results into obligations
        const smtResultMap = new Map(
          smtResults.map((r) => [r.obligationId, r])
        );
        const resolvedObligations = allObligations.map((obl) => {
          const smtResult = smtResultMap.get(obl.id);
          if (smtResult) {
            return { ...obl, status: smtResult.status } as const;
          }
          return { ...obl, status: 'PENDING' as const };
        });

        // 8. Compute digest
        const entrypointFiles = discovered.map((d) => d.modulePath);
        const digest = computeDigest(entrypointFiles);

        // 9. Write artifacts
        writeArtifacts(
          artifactDir,
          {
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
          },
          {
            artifactVersion: '3.0',
            artifactDigest: digest,
            entrypoints: discovered.map((d) => ({
              path: d.modulePath,
              digest: computeDigest([d.modulePath]),
            })),
            targets,
            specs: discovered.map((d, i) => ({
              specId: d.spec.id,
              kind: d.spec.kind,
              modulePath: d.modulePath,
              exportName: 'specs',
              index: i,
              specHash: '',
            })),
          }
        );

        console.log(`Artifacts written to ${artifactDir}/`);

        if (refuted > 0) {
          console.error(`${refuted} SMT obligation(s) REFUTED`);
          process.exit(1);
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
