import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test-setup.ts'],
    include: [
      'utils/**/*.test.ts',
      'worker/**/*.test.ts',
    ],
    // 排除 React 组件 / 浏览器集成测 (没装 jsdom)
    exclude: ['node_modules', '**/node_modules/**', '.worktrees', 'dist'],
  },
});
