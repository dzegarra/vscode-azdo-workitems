// ESLint for a VS Code extension written and maintained by AI agents.
// Type-aware strict rules catch the mistakes agents tend to make (unhandled
// promises, unsafe `any`, dead conditions, forgotten switch cases); import
// resolution is left to `tsc --noEmit`; formatting is left to Prettier.
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**', '**/*.js', '**/*.mjs', '**/*.cjs'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Numbers and booleans in template literals are fine; objects, nullish values and `any` are not.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      // `() => doSomething()` returning void is idiomatic in callbacks.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Conventions from AGENTS.md.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': ['error', { functions: true, classes: true, variables: true }],
      'no-nested-ternary': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      // Asymmetric matchers (`expect.any`, `expect.objectContaining`…) are typed `any`.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // A failing `!` in a test fails the test, which is what we want.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  eslintConfigPrettier
);
