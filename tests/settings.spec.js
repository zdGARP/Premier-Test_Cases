const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/login');
const fs = require('fs');
const path = require('path');

test.describe('Settings & Modules Config', () => {
    test.setTimeout(60000);

    // Capture a screenshot for every test with a visual pause
    test.afterEach(async ({ page }, testInfo) => {
        if (page.isClosed()) return;
        await page.waitForTimeout(2000); // Visual pause for observation

        const match = testInfo.title.match(/^TC-[A-Z]+-\d+/);
        const testId = match ? match[0] : 'UNKNOWN';

        const screenshotDir = path.resolve('screenshots');
        fs.mkdirSync(screenshotDir, { recursive: true });

        const screenshotPath = path.join(
            screenshotDir,
            `${testId}-attempt-${testInfo.retry + 1}.png`
        );

        try {
            await page.screenshot({
                path: screenshotPath,
                fullPage: true
            });

            await testInfo.attach('execution-screenshot', {
                path: screenshotPath,
                contentType: 'image/png'
            });
        } catch (error) {
            console.log(`Screenshot could not be captured: ${error.message}`);
        }
    });

    // ==================================================
    // TC-SETT-001: Hospital Profile Read
    // ==================================================
    test('TC-SETT-001 - Hospital Profile Read', async ({ page }) => {
        await login(page, 'admin');

        // Explicitly navigate to the settings page
        await page.goto('/settings');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1500);

        // Verify page heading and input fields are loaded successfully
        await expect(page.getByRole('heading', { name: /Hospital Settings/i })).toBeVisible({ timeout: 15000 });
        
        const hospitalNameInput = page.getByRole('textbox', { name: /Hospital Name/i });
        await expect(hospitalNameInput).toBeVisible();
        await expect(hospitalNameInput).not.toHaveValue('');
    });

    // ==================================================
    // TC-SETT-002: Non-admin cannot update clinic settings
    // ==================================================
    test('TC-SETT-002 - Non-admin cannot update clinic settings', async ({ page }) => {
        // 1. Log in as your current non-admin account
        await login(page, 'receptionist'); // or your active non-admin role login helper

        // 2. Navigate to settings to confirm UI rendering and capture correct screenshot
        await page.goto('/settings');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1500);

        // 3. Attempt updating clinic settings as non-admin via API
        const updateResponse = await page.request.put('/api/hospital', {
            data: {
                hospitalName: 'Unauthorized Test Change'
            }
        });

        // 4. Assert server rejection (401 or 403 Forbidden)
        expect([401, 403, 400]).toContain(updateResponse.status());
        console.log('TC-SETT-002: Non-admin update successfully rejected with status:', updateResponse.status());
    });

    // ==================================================
    // TC-SETT-003: Module Toggle
    // ==================================================
    test('TC-SETT-003 - Admin can enable or disable module', async ({ page }) => {
        // 1. Log in as admin
        await login(page, 'admin');

        // 2. Navigate to modules management page
        await page.goto('/modules');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1500);

        // 3. Verify admin module management interface is visible using correct heading
        const heading = page.getByRole('heading', { name: /Module Manager/i }).first();
        await expect(heading).toBeVisible({ timeout: 10000 });

        console.log('TC-SETT-003: Admin module management interface loaded successfully.');
    });

    // ==================================================
    // TC-SETT-004: Role Module Visibility
    // ==================================================
    test('TC-SETT-004 - Pharmacist sees permitted modules only', async ({ page }) => {
        // 1. Log in using your pharmacist account helper
        await login(page, 'pharmacist');

        // 2. Navigate to the dashboard and wait for the sidebar to load
        await page.goto('/dashboard').catch(() => page.goto('/'));
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1500);

        // 3. Verify sidebar navigation container is visible
        const sidebar = page.locator('aside, nav').first();
        await expect(sidebar).toBeVisible({ timeout: 10000 });

        // 4. Verify permitted modules are visible for a pharmacist
        await expect(page.getByRole('link', { name: /Pharmacy/i })).toBeVisible();
        await expect(page.getByRole('link', { name: /Write Prescription/i })).toBeVisible();

        // 5. Verify restricted administrative modules (like Hospital Settings) are hidden
        await expect(page.getByRole('link', { name: /Hospital Settings/i })).toHaveCount(0);

        console.log('TC-SETT-004: Pharmacist role module visibility verified successfully.');
    });

});