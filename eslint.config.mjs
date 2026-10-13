import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'build/**', '.tmp/**'] },
  js.configs.recommended,
  {
    files: ['app/**/*.js', 'completed/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.serviceworker, firebase: 'readonly', ClipboardJS: 'readonly' }
    },
    plugins: { '@stylistic': stylistic },
    rules: { '@stylistic/max-len': 'off', '@stylistic/no-trailing-spaces': 'error' }
  },
  {
    files: ['app/**/*.js'],
    rules: {
      'no-var': 'error',
      '@stylistic/indent': ['error', 2],
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/semi': ['error', 'always']
    }
  },
  { files: ['test/**/*.js'], languageOptions: { globals: globals.node, sourceType: 'commonjs' } }
];
