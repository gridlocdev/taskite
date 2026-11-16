import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Packages are used through their entry points (`src/index.ts`), never through their other source files. */
const DEEP_IMPORTS = {
  regex: '^(@taskite/[^/]+|(\\.\\./)+(packages/)?(core|ui))/src(?!/index\\.ts$)(/|$)',
  message: "Import from the package's entry point (@taskite/core, @taskite/ui).",
};

export default tseslint.config(
  {
    ignores: [
      'apps/desktop/legacy/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/.types/**',
      '.types-e2e/**',
      '.e2e-*/**',
      '**/node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': ['error', { patterns: [DEEP_IMPORTS] }],
    },
  },
  {
    // Typed rules: slower, so source files only. An eslint-disable for them is an exception like any other.
    files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false },
      ],
    },
  },
  {
    // Build scripts run in Node.
    files: ['**/scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    // The engine must stay portable: browser, worker, Node, Electron renderer. Its tests run in Node.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage', 'process'],
      'no-restricted-imports': [
        'error',
        { patterns: [DEEP_IMPORTS, { group: ['node:*', 'preact', 'preact/*', '@preact/*'] }] },
      ],
    },
  },
);
