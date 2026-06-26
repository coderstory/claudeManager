import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.{js,mjs,ts}', '__tests__/**/*.spec.{js,mjs,ts}'],
    environment: 'node',
  },
});