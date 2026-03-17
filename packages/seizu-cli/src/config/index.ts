import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SeizuConfig } from '../doc/types';

export interface ResolvedConfig {
  readonly config: SeizuConfig;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateConfig(config: unknown): asserts config is SeizuConfig {
  if (!isRecord(config)) {
    throw new ConfigError('Config must export a default object.');
  }

  if (!config.title || typeof config.title !== 'string') {
    throw new ConfigError(
      'Config must export a default object with { title: string, contracts: string[] }'
    );
  }

  if (!config.contracts || !Array.isArray(config.contracts)) {
    throw new ConfigError(
      'Config must export a default object with { contracts: string[] } (glob patterns)'
    );
  }

  if (!isRecord(config.verify) || !Array.isArray(config.verify.contracts)) {
    throw new ConfigError(
      'Config must export a default object with { verify: { contracts: ContractEntry[] } }'
    );
  }

  if (config.formalSpec !== undefined) {
    if (!isRecord(config.formalSpec)) {
      throw new ConfigError('formalSpec must be an object');
    }
    if (!Array.isArray(config.formalSpec.entrypoints)) {
      throw new ConfigError('formalSpec.entrypoints must be a string array');
    }
    for (const ep of config.formalSpec.entrypoints) {
      if (typeof ep !== 'string') {
        throw new ConfigError(
          'formalSpec.entrypoints must contain only strings'
        );
      }
    }
  }
}

export async function loadConfig(configPath?: string): Promise<ResolvedConfig> {
  const absolutePath = resolve(process.cwd(), configPath ?? 'seizu.config.ts');

  if (!existsSync(absolutePath)) {
    throw new ConfigError(`Config file not found: ${absolutePath}`);
  }

  const module = (await import(pathToFileURL(absolutePath).href)) as {
    readonly default?: unknown;
  };
  const rawConfig = module.default;

  validateConfig(rawConfig);
  return { config: rawConfig };
}
