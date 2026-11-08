// ESLint flat config — lint only; formatting is owned by Prettier.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      'node_modules/**',
      'packages/**/test/fixtures/**',
      '*.tgz',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['packages/*/src/**/*.ts'],
    rules: {
      // Sources use .ts-suffixed relative imports by design; `no-unresolved`
      // style import rules are intentionally out of scope.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Tests and scripts are plain .mjs; keep the bar at no-undef + syntax.
    files: ['packages/*/test/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
);
