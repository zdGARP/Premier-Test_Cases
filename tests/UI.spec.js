const { test, expect } = require('./screenshots');
const fs = require('fs');
const path = require('path');

// Shared by the responsive tests: opens the public pages and returns a list of layout problems
async function checkResponsive(page, tcId, WIDTH) {
  const shotsDir = path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });

  const problems = [];
  const randomPhone = prefix => prefix + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

  async function checkLayout(label, keyElements) {
    // 1. The page uses the device width (the viewport meta tag works)
    const vw = await page.evaluate(() => window.innerWidth);
    if (vw !== WIDTH) {
      problems.push(`${label}: the page layout is ${vw}px wide, not ${WIDTH}px (viewport meta tag missing or wrong?)`);
    }

    // 2. No sideways scrolling
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    if (scrollWidth > vw + 1) {
      problems.push(`${label}: page scrolls sideways (content is ${scrollWidth}px wide on a ${vw}px screen)`);
    }

    // 3. No visible element sticks out of the screen (scrolling lists and clipped areas are ignored)
    const offenders = await page.evaluate(() => {
      const vw = window.innerWidth;
      const out = [];
      const clipped = el => {
        for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== 'visible') return true;
        }
        return false;
      };
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) continue;
        if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) {
          out.push(`<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 50)}"> reaches ${Math.round(r.right)}px`);
        }
      }
      return out.slice(0, 8);
    });
    for (const o of offenders) problems.push(`${label}: element sticks out of the screen: ${o}`);

    // 4. The main elements are visible, inside the screen width, and not squashed
    for (const [name, locator] of keyElements) {
      try {
        await expect(locator.first()).toBeVisible({ timeout: 8000 });
        const box = await locator.first().boundingBox();
        if (!box) continue;
        if (box.x < -1 || box.x + box.width > vw + 1) problems.push(`${label}: "${name}" is cut off by the screen edge`);
        if (name !== 'heading' && box.width < 150) problems.push(`${label}: "${name}" is only ${Math.round(box.width)}px wide`);
      } catch {
        problems.push(`${label}: "${name}" is not visible`);
      }
    }

    // For information: tap targets under 44px (a common guideline, not a failure)
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('button, a, input, select')]
        .filter(el => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden' && r.height < 44;
        })
        .map(el => `${el.tagName.toLowerCase()} "${(el.innerText || el.placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 25)}" ${Math.round(el.getBoundingClientRect().height)}px`)
        .slice(0, 8)
    );
    if (small.length) console.log(`${label}: touch targets under 44px high (information only): ${small.join(' | ')}`);

    await page.screenshot({ path: path.join(shotsDir, `${tcId}_${label}.png`), fullPage: true });
    console.log(`${label}: checked at ${WIDTH}px`);
  }

  // Page 1: login
  await page.goto('/auth');
  await page.waitForLoadState('networkidle');
  await checkLayout('login-page', [
    ['email field', page.getByPlaceholder('you@hospital.com')],
    ['password field', page.locator('input[type="password"]')],
    ['Sign In button', page.getByRole('button', { name: /^sign in$/i })],
  ]);

  // Page 2: QR registration (step 1)
  await page.goto('/premier-plus-qr');
  await page.waitForLoadState('networkidle');
  await checkLayout('qr-step1-registration', [
    ['heading', page.getByText('Patient Registration')],
    ['first name field', page.getByPlaceholder('e.g. Rahul')],
    ['mobile number field', page.getByPlaceholder('10-digit number')],
    ['Continue button', page.getByRole('button', { name: /Continue to Appointment/i })],
  ]);

  // Page 3: QR appointment (step 2), only if the form can be completed
  try {
    await page.getByPlaceholder('e.g. Rahul').fill('Layout');
    await page.getByPlaceholder('e.g. Sharma').first().fill('Test');
    await page.getByPlaceholder('10-digit number').fill(randomPhone('9'));
    await page.getByPlaceholder('e.g. Priya').fill('Layoutpartner');
    await page.getByPlaceholder('e.g. Sharma').nth(1).fill('Test');
    await page.getByPlaceholder('10-digit mobile number').fill(randomPhone('7'));
    await page.getByRole('button', { name: /Continue to Appointment/i }).click();
    await expect(page.getByText('Appointment Details').first()).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await checkLayout('qr-step2-appointment', [['heading', page.getByText('Appointment Details')]]);
  } catch (e) {
    console.log('Step 2 of the QR booking was not reached, so it was not checked: ' + e.message.split('\n')[0]);
    test.info().annotations.push({ type: 'note', description: 'QR step 2 not checked (could not continue from step 1)' });
  }

  // Nothing is submitted, so no records are created.
  return problems;
}

test.describe('TC-UI-001 mobile viewport', () => {
  test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('TC-UI-001: Layout adapts to mobile screen width (375px)', async ({ page }) => {
    test.setTimeout(120000);
    const problems = await checkResponsive(page, 'TC-UI-001', 375);
    expect(problems, 'Layout problems at 375px').toEqual([]);
  });
});

test.describe('TC-UI-002 tablet viewport', () => {
  test.use({ viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('TC-UI-002: Layout adapts to tablet screen width (768px)', async ({ page }) => {
    test.setTimeout(120000);
    const problems = await checkResponsive(page, 'TC-UI-002', 768);
    expect(problems, 'Layout problems at 768px').toEqual([]);
  });
});

test.describe('TC-UI-003 desktop viewport', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('TC-UI-003: Full desktop layout renders complete sidebar and KPI cards (1440x900)', async ({ page }) => {
    test.setTimeout(90000);
    const shotsDir = path.join(__dirname, '..', 'screenshots');
    fs.mkdirSync(shotsDir, { recursive: true });
    const problems = [];

    // Log in and open the dashboard (the sidebar and KPI cards are behind the login)
    await page.goto('/auth');
    await page.getByPlaceholder('you@hospital.com').fill(process.env.TEST_EMAIL);
    await page.locator('input[type="password"]').fill(process.env.TEST_PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page, 'Login failed, check TEST_EMAIL and TEST_PASSWORD in .env').not.toHaveURL(/\/auth/, {
      timeout: 15000,
    });
    await page.waitForLoadState('networkidle');

    // Make sure we are on the Dashboard page
    const dashLink = page.locator('a, button').filter({ hasText: /^\s*Dashboard\s*$/ }).first();
    if (await dashLink.count()) {
      await dashLink.click();
      await page.waitForLoadState('networkidle');
    }
    await page.waitForTimeout(2000); // let the numbers load
    console.log(`Dashboard URL: ${page.url()}`);

    // 1. The page fits the desktop width (no sideways scrolling)
    const vw = await page.evaluate(() => window.innerWidth);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    if (scrollWidth > vw + 1) problems.push(`Page scrolls sideways (content ${scrollWidth}px on a ${vw}px screen)`);

    // 2. The sidebar is complete: expanded, full height, every menu item with its label
    const sidebar = page
      .locator('aside, nav')
      .filter({ hasText: 'Appointments' })
      .filter({ hasText: 'Patients' })
      .first();
    let sidebarRight = 0;
    if (!(await sidebar.count())) {
      problems.push('Sidebar not found (no aside/nav containing Appointments and Patients)');
    } else {
      const box = await sidebar.boundingBox();
      sidebarRight = box.x + box.width;
      console.log(`Sidebar size: ${Math.round(box.width)} x ${Math.round(box.height)}px`);
      if (box.width < 200) problems.push(`Sidebar is only ${Math.round(box.width)}px wide, so it looks collapsed (expected 200px or more)`);
      if (box.width > 400) problems.push(`Sidebar is ${Math.round(box.width)}px wide, which is too wide`);
      if (box.height < 700) problems.push(`Sidebar is only ${Math.round(box.height)}px tall on a 900px screen`);

      const MENU = [
        ['Dashboard', /^Dashboard$/],
        ['Appointments', /^Appointments$/],
        ['Patients', /^Patients$/],
        ['Doctors', /^Doctors$/],
        ['Write Prescription', /^Write Prescri/i],
        ['Prescription Builder', /^Prescription Bui/i],
        ['Pharmacy', /^Pharmacy$/],
        ['Billing', /^Billing$/],
        ['Report Builder', /^Report Builder$/],
        ['Service Reports', /^Service Reports$/],
        ['Notifications', /^Notifications$/],
        ['Modules', /^Modules$/],
        ['Sign Out', /^Sign Out$/i],
      ];
      for (const [name, re] of MENU) {
        const item = sidebar.getByText(re).first();
        if (!(await item.isVisible().catch(() => false))) problems.push(`Sidebar menu item "${name}" is not shown`);
      }
    }

    // 3. KPI cards: big numbers in the main area, shown side by side
    const kpis = await page.evaluate(sidebarRight => {
      const NUM = /^[₹$€]?\s?\d[\d,]*(\.\d+)?\s?%?$/;
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length) continue;
        const text = (el.textContent || '').trim();
        if (!NUM.test(text)) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1 || r.left < sidebarRight) continue;
        const size = parseFloat(cs.fontSize);
        if (size < 18) continue;
        const card = el.closest('[class*="rounded"], [class*="card"]') || el.parentElement;
        out.push({
          value: text,
          size,
          x: Math.round(r.left),
          y: Math.round(r.top),
          label: ((card && card.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        });
      }
      return out;
    }, sidebarRight);

    console.log('KPI CANDIDATES:\n' + kpis.map(k => `${k.value}  (${k.size}px at ${k.x},${k.y})  "${k.label}"`).join('\n'));

    if (kpis.length < 3) {
      problems.push(`Only ${kpis.length} KPI card number(s) found in the main area (expected at least 3)`);
    } else {
      // How many cards share the same row? On desktop they should sit side by side.
      const rows = {};
      for (const k of kpis) {
        const key = Math.round(k.y / 20);
        rows[key] = (rows[key] || 0) + 1;
      }
      const maxInRow = Math.max(...Object.values(rows));
      console.log(`Most KPI cards in one row: ${maxInRow}`);
      if (maxInRow < 3) problems.push(`KPI cards are not side by side (only ${maxInRow} in a row, expected 3 or more)`);
    }

    await page.screenshot({ path: path.join(shotsDir, 'TC-UI-003_dashboard.png'), fullPage: true });

    if (problems.length) {
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1500);
      console.log('PAGE TEXT (first 1500 characters):\n' + text);
    }
    expect(problems, 'Desktop layout problems at 1440x900').toEqual([]);
  });
});

test('TC-UI-004: Unmapped route displays a friendly 404 page', async ({ page }) => {
  test.setTimeout(60000);
  const BAD = '/invalid-page-xyz';
  const shotsDir = path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const problems = [];

  // Uncaught JavaScript errors on the page (a friendly page should not crash)
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));

  const NOT_FOUND = /404|not found|doesn.?t exist|does not exist|can.?t find|cannot find|page.*(missing|unavailable)/i;
  const RAW_ERROR = /cannot (get|post)|nginx|stack trace|unexpected application error|typeerror|referenceerror|internal server error|bad gateway|service unavailable|traceback/i;

  // Open the address that does not exist, with no login (unauthenticated user)
  const response = await page.goto(BAD);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  const status = response.status();
  const finalUrl = new URL(page.url());
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
  console.log(`HTTP status: ${status}  (200 is normal for a single-page app)`);
  console.log(`Final URL: ${finalUrl.pathname}`);
  console.log(`Page text: ${text.slice(0, 400)}`);

  // 1. The server did not fail
  if (status >= 500) problems.push(`The server answered with an error status (${status})`);

  // 2. The page is not blank
  if (text.length < 15) problems.push('The page is blank (almost no text is shown)');

  // 3. No raw server or error text is shown
  const raw = text.match(RAW_ERROR);
  if (raw) problems.push(`A raw server or error message is shown ("${raw[0]}")`);

  // 4. The page tells the visitor that the page was not found
  const hasMessage = NOT_FOUND.test(text);
  if (!hasMessage) {
    if (finalUrl.pathname.startsWith('/auth')) {
      problems.push('The visitor was sent to the login page instead of seeing a 404 message');
    } else {
      problems.push('The page does not say that the page was not found');
    }
  }

  // 5. The page fits the screen
  const vw = await page.evaluate(() => window.innerWidth);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  if (scrollWidth > vw + 1) problems.push(`The 404 page scrolls sideways (${scrollWidth}px on a ${vw}px screen)`);

  // 6. There is a way back (link or button)
  const backItems = page
    .locator('a, button')
    .filter({ hasText: /home|dashboard|back|go to|return|take me|login|sign in/i })
    .filter({ visible: true });
  const backCount = await backItems.count();
  if (backCount === 0) problems.push('There is no link or button to leave the 404 page');

  // 7. No uncaught JavaScript errors
  if (jsErrors.length) problems.push(`Uncaught JavaScript error on the page: ${jsErrors[0].slice(0, 150)}`);

  // Evidence of the 404 page itself
  await page.screenshot({ path: path.join(shotsDir, 'TC-UI-004_404-page.png'), fullPage: true });

  // 8. The way back works and does not lead to another 404
  if (backCount > 0) {
    const label = ((await backItems.first().innerText()) || '').trim();
    const before = page.url();
    await backItems.first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    const afterUrl = page.url();
    const afterText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    console.log(`Clicked "${label}" -> ${new URL(afterUrl).pathname}`);
    if (afterUrl === before) problems.push(`The "${label}" button did not leave the 404 page`);
    else if (/404|page not found/i.test(afterText)) problems.push(`The "${label}" button leads to another 404 page`);
  }

  // Return to the 404 page so the automatic screenshot shows it
  await page.goto(BAD);
  await page.waitForLoadState('networkidle');

  if (problems.lengtha) console.log('PROBLEMS FOUND:\n' + problems.join('\n'));
  expect(problems, 'The unmapped route does not show a friendly 404 page').toEqual([]);
});

// TC-UI-005: Verify /laboratory and /ipd display under-development notice
test('TC-UI-005: Under Development pages', async ({ page }) => {

    // Login
    await page.goto('/auth');

    await page.getByPlaceholder('you@hospital.com').fill(process.env.TEST_EMAIL);
    await page.locator('input[type="password"]').fill(process.env.TEST_PASSWORD);

    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Verify login was successful
    await expect(page).not.toHaveURL(/\/auth/, { timeout: 15000 });

    await page.waitForLoadState('networkidle');

    // Check Laboratory page
    await page.goto('/laboratory');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Under Development', { exact: true })).toBeVisible();
    await expect(page.getByText(/This feature is currently being built/i)).toBeVisible();

    console.log('PASS: /laboratory displays the under-development notice.');

    // Check IPD page
    await page.goto('/ipd');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Under Development', { exact: true })).toBeVisible();
    await expect(page.getByText(/This feature is currently being built/i)).toBeVisible();

    console.log('PASS: /ipd displays the under-development notice.');

});

// TC-UI-006: Verify user receives immediate visual feedback via Sonner toasts
test('TC-UI-006: Toast Feedback', async ({ page }) => {

    // Login
    await page.goto('/auth');

    await page.getByPlaceholder('you@hospital.com').fill(process.env.TEST_EMAIL);
    await page.locator('input[type="password"]').fill(process.env.TEST_PASSWORD);

    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page).not.toHaveURL(/\/auth/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    // Listen for Sonner toast notifications
    const toast = page.locator('[data-sonner-toast]');

    // Trigger an action that may display a toast
    const buttons = page.getByRole('button');
    const count = await buttons.count();

    let toastFound = false;

    for (let i = 0; i < count; i++) {
        const button = buttons.nth(i);

        if (await button.isVisible() && await button.isEnabled()) {
            const name = (await button.innerText().catch(() => '')).trim();

            // Avoid clicking Sign Out or other potentially destructive actions
            if (/sign out|delete|remove|logout/i.test(name)) {
                continue;
            }

            await button.click().catch(() => {});
            
            if (await toast.first().isVisible().catch(() => false)) {
                toastFound = true;
                console.log(`Toast displayed after clicking: ${name || 'unnamed button'}`);
                break;
            }

            // Stop after testing one harmless button
            break;
        }
    }

    // Verify visual feedback
    await expect(toast.first()).toBeVisible({ timeout: 5000 });

    console.log('PASS: Sonner toast notification is visible.');

});

// TC-UI-007: Keyboard Accessibility
test('TC-UI-007: Login form navigable and submittable using keyboard', async ({ page }) => {

    // Open login page
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');

    // Check email and password fields
    const email = page.getByPlaceholder('you@hospital.com');
    const password = page.locator('input[type="password"]');
    const signIn = page.getByRole('button', { name: /^sign in$/i });

    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(signIn).toBeVisible();

    // Start keyboard navigation from the email field
    await email.focus();

    // Verify Tab moves focus to the password field
    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();

    // Verify Tab moves focus to the Sign In button
    await page.keyboard.press('Tab');
    await expect(signIn).toBeFocused();

    console.log('PASS: Email, password and Sign In are keyboard accessible.');

    // Verify Escape does not crash or break the login page
    await page.keyboard.press('Escape');
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();

    console.log('PASS: Login form remains usable after pressing Escape.');

    // Fill credentials for keyboard-based submission
    await email.fill(process.env.TEST_EMAIL);
    await password.fill(process.env.TEST_PASSWORD);

    // Focus the Sign In button and submit using Enter
    await signIn.focus();
    await page.keyboard.press('Enter');

    // Verify login succeeds
    await expect(page).not.toHaveURL(/\/auth/, { timeout: 15000 });

    console.log('PASS: Login form can be submitted using the keyboard.');

});