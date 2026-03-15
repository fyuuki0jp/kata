import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { CAC } from 'cac';
import { ConfigError, loadConfig } from '../config';
import { resolveGlobs } from '../doc/parser/source-resolver';
import { detectContracts, generateSkeleton } from '../migrate/legacy';

export function registerMigrateCommand(cli: CAC): void {
  cli
    .command('migrate legacy', 'Migrate legacy contracts to formal specs')
    .option('--config <path>', 'Config file path', {
      default: 'seizu.config.ts',
    })
    .option('--output <path>', 'Output file path', {
      default: 'specs/migrated.ts',
    })
    .option('--stdout', 'Write to stdout instead of file', { default: false })
    .action(async (options) => {
      try {
        const { config } = await loadConfig(options.config);
        const basePath = process.cwd();

        // Resolve contract source files from config globs
        const contractFiles = resolveGlobs(config.contracts, basePath);

        if (contractFiles.length === 0) {
          console.error(
            'No contract files found. Check your config contracts globs.'
          );
          process.exit(2);
          return;
        }

        // Detect contracts in all source files
        const allContracts = contractFiles.flatMap((file) =>
          detectContracts(file)
        );

        if (allContracts.length === 0) {
          console.log('No define() calls detected in contract files.');
          process.exit(0);
          return;
        }

        const skeleton = generateSkeleton(allContracts);

        if (options.stdout) {
          process.stdout.write(skeleton);
        } else {
          const outputPath = resolve(basePath, options.output);
          mkdirSync(dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, skeleton, 'utf-8');
          console.log(
            `Migrated ${allContracts.length} contract(s) → ${outputPath}`
          );
        }

        process.exit(0);
      } catch (error) {
        if (error instanceof ConfigError) {
          console.error(`Configuration error: ${error.message}`);
          process.exit(2);
        }
        throw error;
      }
    });
}
