import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/app.js', 'src/listeners/**', 'src/services/reportGenerator.js', 'src/services/helloSign.js', 'src/utils/pdfConverter.js', 'src/utils/logger.js'],
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
  },
});
