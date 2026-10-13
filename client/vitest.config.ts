import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    // The Font Studio renders a large results grid; user-event interactions
    // on it exceed the default 5s budget in jsdom.
    testTimeout: 30_000,
  },
});
