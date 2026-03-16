import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/tests/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'packages/seizu-cli/src/compile/digest.ts',
        'packages/seizu-cli/src/compile/discovery.ts',
        'packages/seizu-cli/src/compile/resolver.ts',
      ],
      exclude: [
        'packages/*/src/**/*.d.ts',
        'packages/*/src/index.ts',
        'packages/*/src/**/types.ts',
        'packages/seizu-cli/src/cli.ts',
        'packages/seizu-cli/src/commands/**/*',
        'packages/seizu-cli/src/init/**/*',
        'packages/seizu-cli/src/migrate/**/*',
        'packages/seizu-cli/src/doc/**/index.ts',
        'packages/example/**',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
