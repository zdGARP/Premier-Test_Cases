// tests/helpers/login.js
async function login(page, role = 'admin') {
    const username =
        role === 'admin'
            ? process.env.TEST_USERNAME
            : process.env[`${role.toUpperCase()}_USERNAME`] || process.env.TEST_USERNAME;

    const password =
        role === 'admin'
            ? process.env.TEST_PASSWORD
            : process.env[`${role.toUpperCase()}_PASSWORD`] || process.env.TEST_PASSWORD;

    if (!process.env.BASE_URL || !username || !password) {
        throw new Error(
            `Missing BASE_URL or credentials for role: ${role}`
        );
    }

    console.log(`Opening login page for role: ${role}...`);
    await page.goto('/auth');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000); // Visual pause

    // Fill email
    const emailInput = page.getByPlaceholder('you@hospital.com');
    await emailInput.waitFor({ state: 'visible', timeout: 30000 });
    await emailInput.fill(username);
    await page.waitForTimeout(500); // Visual pause

    // Fill password
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.waitFor({ state: 'visible', timeout: 30000 });
    await passwordInput.fill(password);
    await page.waitForTimeout(500); // Visual pause

    // Click Sign In
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await signInButton.waitFor({ state: 'visible', timeout: 30000 });
    await signInButton.click();
    console.log('Clicked Sign In, waiting for navigation...');

    // Wait for successful login
    await page.waitForFunction(
        () => !window.location.href.includes('/auth'),
        { timeout: 30000 }
    );

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000); // Visual pause to watch dashboard load
    console.log('Login successful as:', role, 'Current URL:', page.url());
}

module.exports = { login };