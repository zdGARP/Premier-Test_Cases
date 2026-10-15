require('dotenv').config();

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,

  reporter: [
    ['list'],
    ['html', {
      outputFolder: 'reports/html',
      open: 'never'
    }],
    ['./utils/jsonReporter.js']
  ],

  outputDir: 'results/test-results',

  use: {
    baseURL: process.env.BASE_URL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome']
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
