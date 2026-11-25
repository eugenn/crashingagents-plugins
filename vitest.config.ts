import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'plugins/vscode/**/*.test.ts',
      'plugins/openchamber/**/*.test.ts',
      'plugins/orca/**/*.test.ts',
    ],
    testTimeout: 30000,
  },
});
