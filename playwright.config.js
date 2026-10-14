require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    timeout: 60000,
    expect: {
        timeout: 10000
    },
    fullyParallel: false,
    workers: 1,
    maxFailures: 0,

    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }]
    ],

    use: {
        baseURL: process.env.BASE_URL,
        headless: process.env.HEADLESS === 'true',
        screenshot: 'off',
        video: 'off',
        trace: 'off'
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        }
    ]
});