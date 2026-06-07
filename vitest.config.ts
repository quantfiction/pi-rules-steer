import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testing/**'],
      reporter: ['text', 'html'],
      thresholds: {
        // Per-glob thresholds: the v0.1.4 task names these three files as
        // the load-bearing surface. We don't gate on global coverage —
        // formatting helpers (doctor-format) and adapters (commands/doctor)
        // are intentionally under-tested per the testing-principles
        // "over-testing thin wrappers" anti-pattern.
        'src/extraction/scope.ts': { lines: 80, branches: 80, functions: 80, statements: 80 },
        'src/extraction/bash.ts': { lines: 80, branches: 80, functions: 80, statements: 80 },
        'src/matching/compile.ts': { lines: 80, branches: 80, functions: 80, statements: 80 },
        'src/index.ts': { lines: 80, branches: 80, functions: 80, statements: 80 },
      },
    },
  },
});
