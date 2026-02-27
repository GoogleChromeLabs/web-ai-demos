import js from '@eslint/js';
import google from 'eslint-config-google';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    rules: {
      ...google.rules,
      ...prettier.rules,
      'require-jsdoc': 'off',
      'valid-jsdoc': 'off',
      'max-len': ['warn', { code: 100, ignoreUrls: true }],
      'no-unused-vars': 'warn',
      'no-undef': 'error',
    },
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: 'readonly',
      },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
