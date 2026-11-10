import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The rules of the game stay pure: no DOM, no clock, no ambient randomness,
    // so every scoring path is unit-testable and seedable.
    files: ['src/game/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded rng in src/game/rng.ts.' }],
      'no-restricted-globals': ['error', 'document', 'window', 'performance', 'Date'],
    },
  },
);
