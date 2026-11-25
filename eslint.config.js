import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      'node_modules/**',
      // Pre-built OpenChamber guest bundles shipped in plugins/openchamber.
      'plugins/openchamber/panel/main.js',
      'plugins/openchamber/service/main.js',
      'plugins/openchamber/opencode-plugin/index.js',
      // Pre-built Orca plugin bundles shipped in plugins/orca.
      'plugins/orca/panel/main.js',
      'plugins/orca/worker/main.mjs',
      'plugins/orca/bin/crashing-agents.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  { files: ['**/*.js'], languageOptions: { globals: { process: 'readonly' } } },
);
