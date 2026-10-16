import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['.wxt/**', '.output/**', 'node_modules/**', 'artifacts/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.webextensions } },
    plugins: { 'react-hooks': hooks },
    rules: { ...hooks.configs.recommended.rules, '@typescript-eslint/no-explicit-any': 'error' },
  },
);
