const base = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const test = base.test.extend({
  page: async ({ page }, use, testInfo) => {
    await use(page); // the test runs here

    // After the test: save a screenshot to /screenshots
    const dir = path.join(__dirname, '..', 'screenshots');
    fs.mkdirSync(dir, { recursive: true });

    const id = testInfo.title.split(':')[0].trim(); // e.g. "TC-QR-001"
    await page.screenshot({
      path: path.join(dir, `${id}_${testInfo.status}.png`),
      fullPage: true,
    });
  },
});

module.exports = { test, expect: base.expect };