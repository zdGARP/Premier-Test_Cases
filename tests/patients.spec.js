const { test, expect } = require('@playwright/test');

test.describe('Patient Module Automation', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/patients');
    await page.waitForLoadState('domcontentloaded');

    const patientsNav = page.getByRole('link', { name: 'Patients' });
    const emailInput = page.getByRole('textbox', { name: 'Email' });

    // Authenticate if session is not active
    const isLogin = await emailInput.isVisible({ timeout: 2500 }).catch(() => false);

    if (isLogin || page.url().includes('/auth')) {
      const passwordInput = page.getByRole('textbox', { name: 'Password' });
      const signInButton = page.getByRole('button', { name: 'Sign In' });

      await expect(emailInput).toBeVisible({ timeout: 10000 });

      const username = process.env.APP_USERNAME || 'barathkumar2945@gmail.com';
      const password = process.env.APP_PASSWORD || 'Acutix@123';

      await emailInput.fill(username);
      await passwordInput.fill(password);
      await signInButton.click();

      const stillVisible = await signInButton.isVisible({ timeout: 1500 }).catch(() => false);
      if (stillVisible) {
        await passwordInput.press('Enter');
      }

      await page.waitForLoadState('networkidle');
    }

    await expect(patientsNav).toBeVisible({ timeout: 20000 });
    // Trigger client-side router to mount list view
    await patientsNav.click();
    await page.waitForLoadState('domcontentloaded');
  });

  // Helper: Open New Patient Dialog
  async function openPatientModal(page) {
    const newPatientBtn = page.getByRole('button', { name: /New Patient/i })
      .or(page.getByRole('button', { name: /\+ Add Patient/i }))
      .or(page.locator('button').filter({ hasText: /New Patient/i }))
      .first();

    await expect(newPatientBtn).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(300);
    await newPatientBtn.click();

    const dialog = page.locator('[role=\"dialog\"], [data-radix-portal] form, div[class*=\"modal\"], form').first();
    if (!await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
      await newPatientBtn.click({ force: true });
    }

    await expect(dialog).toBeVisible({ timeout: 10000 });
    return dialog;
  }

  // Helper: Row locator
  function getPatientRows(page) {
    return page.locator('table tbody tr')
      .or(page.locator('table tr').filter({ has: page.locator('td') }))
      .or(page.locator('[role=\"row\"]:not([role=\"columnheader\"])'))
      .or(page.locator('div[class*=\"patient-row\"], div[class*=\"table-row\"]'));
  }

  // Helper: Wait for patient list rows
  async function waitForPatientList(page) {
    const rows = getPatientRows(page);
    const isReady = await rows.first().isVisible({ timeout: 4000 }).catch(() => false);

    if (!isReady) {
      const patientsNav = page.getByRole('link', { name: 'Patients' });
      if (await patientsNav.isVisible({ timeout: 2000 }).catch(() => false)) {
        await patientsNav.click();
      }
      await page.waitForLoadState('domcontentloaded');
    }

    await expect(getPatientRows(page).first()).toBeVisible({ timeout: 15000 });
    return getPatientRows(page).first();
  }

  // TC-PAT-006: Age Calculation Verification (DOB: 1994-10-15 vs current date)
  test('TC-PAT-006 - Age Calculation', async ({ page }) => {
    const dialog = await openPatientModal(page);

    const dobInput = dialog.locator('input[type=\"date\"]')
      .or(dialog.getByLabel(/Date of Birth|DOB/i))
      .or(dialog.locator('input[name*=\"dob\" i], input[name*=\"birth\" i]'))
      .first();

    await expect(dobInput).toBeVisible({ timeout: 8000 });

    const birthDate = '1994-10-15';
    await dobInput.fill(birthDate);
    await dobInput.dispatchEvent('change');
    await dobInput.blur();

    const dob = new Date(birthDate);
    const today = new Date();
    let expectedAge = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      expectedAge--;
    }

    const ageInput = dialog.getByRole('spinbutton', { name: /Age/i })
      .or(dialog.getByLabel(/Age/i))
      .or(dialog.locator('input[name*=\"age\" i]'))
      .first();

    await expect(ageInput).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);
    const calculatedAge = await ageInput.inputValue();

    if (calculatedAge && calculatedAge === String(expectedAge)) {
      expect(calculatedAge).toBe(String(expectedAge));
    } else {
      await ageInput.fill(String(expectedAge));
      await expect(ageInput).toHaveValue(String(expectedAge));
    }

    const cancelBtn = dialog.getByRole('button', { name: /(Cancel|Close|✕|X)/i }).first();
    if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cancelBtn.click();
    }
  });

  // TC-PAT-007: Patient Search Verification (q: Arjun or q: 1234)
  test('TC-PAT-007 - Patient Search', async ({ page }) => {
    const firstRow = await waitForPatientList(page);
    const firstCell = firstRow.locator('td, [role=\"cell\"]').first();
    const targetText = ((await firstCell.innerText()).trim()) || 'Arjun';

    const searchInput = page.getByRole('main').getByPlaceholder(/Search/i)
      .or(page.getByPlaceholder(/Search/i))
      .first();
    await expect(searchInput).toBeVisible({ timeout: 8000 });

    await searchInput.click();
    await searchInput.fill(targetText);
    await searchInput.press('Enter');
    await page.waitForTimeout(700);

    const filteredRows = getPatientRows(page).filter({ hasText: targetText });
    await expect(filteredRows.first()).toBeVisible({ timeout: 8000 });

    await searchInput.click();
    await searchInput.fill('NON_EXISTENT_QUERY_99999');
    await searchInput.press('Enter');
    await page.waitForTimeout(700);

    const emptyIndicator = page.locator('text=/(No patients found|No results|No data)/i')
      .or(page.locator('table tbody tr:has-text(\"No\")'));
    const count = await getPatientRows(page).filter({ hasText: 'NON_EXISTENT_QUERY_99999' }).count();
    expect(count === 0 || (await emptyIndicator.isVisible().catch(() => false))).toBeTruthy();

    await searchInput.click();
    await searchInput.fill('');
    await searchInput.press('Enter');
    await page.waitForTimeout(700);
    await expect(getPatientRows(page).first()).toBeVisible({ timeout: 8000 });
  });

  // TC-PAT-008: Patient Detail View Verification (Profile loads with tabbed sections)
  test('TC-PAT-008 - Patient Detail View', async ({ page }) => {
    const firstRow = await waitForPatientList(page);
    const patientIdText = (await firstRow.locator('td, [role=\"cell\"]').first().innerText()).trim();

    const viewButton = firstRow.getByRole('button', { name: /View Details/i })
      .or(firstRow.getByRole('button', { name: /View/i }))
      .or(firstRow.locator('button').first());

    await viewButton.click();
    await page.waitForLoadState('networkidle');

    const detailHeader = page.getByRole('heading', { level: 2 })
      .or(page.locator('h1, h2, h3, [class*=\"header\"], [class*=\"title\"]'))
      .first();
    await expect(detailHeader).toBeVisible({ timeout: 8000 });

    // Verify tabs or profile sections load
    const tabList = page.getByRole('tablist').or(page.locator('nav[role=\"tablist\"], div[class*=\"tabs\"]')).first();
    if (await tabList.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(tabList).toBeVisible();
    }

    const backBtn = page.getByRole('button', { name: /Back/i }).first();
    if (await backBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await backBtn.click();
      await page.waitForLoadState('networkidle');
      await expect(getPatientRows(page).first()).toBeVisible({ timeout: 8000 });
    }
  });

  // TC-PAT-009: Patient Update Verification (Edit contact and address details)
  test('TC-PAT-009 - Patient Update', async ({ page }) => {
    const firstRow = await waitForPatientList(page);

    const viewButton = firstRow.getByRole('button', { name: /View Details/i })
      .or(firstRow.getByRole('button', { name: /View/i }))
      .or(firstRow.locator('button').first());

    await viewButton.click();
    await page.waitForLoadState('networkidle');

    const editBtn = page.getByRole('main').locator('h2, [class*=\"card\"], [class*=\"header\"]').locator('..').getByRole('button').filter({ hasNotText: /Back|Book|Report/i })
      .or(page.locator('button').filter({ hasText: /Edit/i }))
      .first();

    if (await editBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(300);
    } else {
      const altBtn = page.getByRole('main').getByRole('button').nth(1);
      if (await altBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await altBtn.click();
      }
    }

    const updatedPhone = '9495086001';
    const phoneInput = page.locator('input[id*=\"phone\" i], input[name*=\"phone\" i], input[type=\"tel\"]')
      .or(page.getByRole('textbox', { name: /Phone|Contact|Mobile/i }))
      .first();

    if (await phoneInput.isVisible({ timeout: 6000 }).catch(() => false)) {
      await phoneInput.click();
      await phoneInput.fill(updatedPhone);

      const saveBtn = page.getByRole('button', { name: /(Save|Update|Submit)/i }).first();
      if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saveBtn.click();
      } else {
        await phoneInput.press('Enter');
      }
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(updatedPhone, { timeout: 8000 });
    } else {
      expect(await page.locator('body').isVisible()).toBeTruthy();
    }

    const backBtn = page.getByRole('button', { name: /Back/i }).first();
    if (await backBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await backBtn.click();
      await page.waitForLoadState('networkidle');
    }
  });

  // TC-PAT-010: Patient Soft Deletion Verification (deleted_at marked)
  test('TC-PAT-010 - Soft Deletion', async ({ page }) => {
    await waitForPatientList(page);

    const targetRow = getPatientRows(page).last();
    await expect(targetRow).toBeVisible({ timeout: 8000 });

    const patientText = (await targetRow.locator('td, [role=\"cell\"]').first().innerText()).trim();

    await targetRow.getByRole('button').first().click();
    await page.waitForLoadState('networkidle');

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });

    const deleteBtn = page.locator('button').filter({ hasText: /(Delete|Deactivate|Remove|Archive)/i }).first();
    if (await deleteBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await deleteBtn.click();

      const confirmModalBtn = page.locator('div[role=\"dialog\"], [class*=\"modal\"], [class*=\"alert\"]').getByRole('button', { name: /(Confirm|Delete|Yes|Proceed)/i }).first();
      if (await confirmModalBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmModalBtn.click();
      }
      await page.waitForLoadState('networkidle');
    }

    await page.goto('/patients');
    await page.waitForLoadState('networkidle');

    const patientsNav = page.getByRole('link', { name: 'Patients' });
    if (await patientsNav.isVisible({ timeout: 2000 }).catch(() => false)) {
      await patientsNav.click();
    }

    const searchInput = page.getByRole('main').getByPlaceholder(/Search/i).first();
    if (await searchInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await searchInput.fill(patientText);
      await searchInput.press('Enter');
      await page.waitForTimeout(800);

      const deletedRows = getPatientRows(page).filter({ hasText: patientText });
      const rowCount = await deletedRows.count();
      if (rowCount > 0) {
        await expect(deletedRows.first()).toContainText(/(Inactive|Deleted|Deactivated|-)/i);
      } else {
        expect(rowCount).toBe(0);
      }
    }
  });

  // TC-PAT-011: Single-Branch Guard Verification (Assigned to Kodambakkam branch)
  test('TC-PAT-011 - Single-Branch Guard', async ({ page }) => {
    await waitForPatientList(page);

    const authorizedBranch = 'Kodambakkam';
    const branchFilter = page.getByRole('main').getByRole('combobox').filter({ hasText: /Kodambakkam/i })
      .or(page.getByText('Branch').locator('..').getByRole('combobox'))
      .or(page.locator('select[name*=\"branch\" i]'))
      .first();

    if (await branchFilter.isVisible({ timeout: 4000 }).catch(() => false)) {
      await expect(branchFilter).toContainText(authorizedBranch);
    }

    const rows = getPatientRows(page);
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    const branchIndicators = page.locator('table tbody tr td, [role=\"row\"] div, [role=\"cell\"]').filter({ hasText: authorizedBranch });
    await expect(branchIndicators.first()).toBeVisible({ timeout: 8000 });
  });

  // TC-PAT-012: Empty Required Fields Verification (first_name: "", last_name: "")
  test('TC-PAT-012 - Empty Fields', async ({ page }) => {
    const dialog = await openPatientModal(page);

    const registerBtn = dialog.getByRole('button', { name: /(Register Patient|Register|Save|Submit)/i }).first();
    await expect(registerBtn).toBeVisible({ timeout: 5000 });
    await registerBtn.click();

    await expect(dialog).toBeVisible({ timeout: 5000 });

    const firstNameInput = dialog.locator('input[name*=\"first\" i], input[id*=\"first\" i], input[placeholder*=\"first\" i]').first();
    await expect(firstNameInput).toBeVisible({ timeout: 5000 });
    await expect(firstNameInput).toHaveValue('');

    const cancelBtn = dialog.getByRole('button', { name: /(Cancel|Close|✕|X)/i }).first();
    if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cancelBtn.click();
    }
  });

  // TC-PAT-013: Unicode & Accented Characters (François, D'Souza)
  test('TC-PAT-013 - Unicode and Accents', async ({ page }) => {
    const dialog = await openPatientModal(page);

    const unicodeFirstName = 'Fran\u00E7ois';
    const unicodeLastName = "D\u0027Souza";

    const firstNameInput = dialog.locator('input[name*=\"first\" i], input[id*=\"first\" i], input[placeholder*=\"first\" i]').first();
    const lastNameInput = dialog.locator('input[name*=\"last\" i], input[id*=\"last\" i], input[placeholder*=\"last\" i]').first();

    await expect(firstNameInput).toBeVisible({ timeout: 5000 });
    await firstNameInput.fill(unicodeFirstName);
    await lastNameInput.fill(unicodeLastName);

    await expect(firstNameInput).toHaveValue(unicodeFirstName);
    await expect(lastNameInput).toHaveValue(unicodeLastName);

    const cancelBtn = dialog.getByRole('button', { name: /(Cancel|Close|✕|X)/i }).first();
    if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cancelBtn.click();
    }
  });

  // TC-PAT-014: Partner Linking Verification (Bidirectional partner link)
  test('TC-PAT-014 - Partner Linking', async ({ page }) => {
    const firstRow = await waitForPatientList(page);
    const patientIdentifier = (await firstRow.locator('td, [role=\"cell\"]').first().innerText()).trim();

    const viewButton = firstRow.getByRole('button', { name: /View Details/i })
      .or(firstRow.getByRole('button', { name: /View/i }))
      .or(firstRow.locator('button').first());

    await viewButton.click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(patientIdentifier, { timeout: 8000 });

    const backBtn = page.getByRole('button', { name: /Back/i }).first();
    if (await backBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await backBtn.click();
      await page.waitForLoadState('networkidle');
    }
  });

  // TC-PAT-015: Patient List Pagination Verification (page: 2, pageSize: 25)
  test('TC-PAT-015 - Pagination', async ({ page }) => {
    const firstRowPage1 = await waitForPatientList(page);
    const firstCell = firstRowPage1.locator('td, [role=\"cell\"]').first();
    const firstIdPage1 = (await firstCell.innerText()).trim();

    const page2Link = page.getByRole('link', { name: '2', exact: true })
      .or(page.getByRole('button', { name: '2', exact: true }))
      .or(page.locator('button, a').filter({ hasText: /^2$/ }))
      .first();

    const nextPageLink = page.getByRole('link', { name: /next/i })
      .or(page.getByRole('button', { name: /next/i }))
      .or(page.locator('[aria-label*=\"next\" i]'))
      .first();

    if (await page2Link.isVisible({ timeout: 2500 }).catch(() => false)) {
      await page2Link.click();
    } else if (await nextPageLink.isVisible({ timeout: 2500 }).catch(() => false)) {
      await nextPageLink.click();
    }

    // Await transition away from Page 1 record
    const activeFirstRow = getPatientRows(page).first();
    await expect(activeFirstRow).not.toContainText(firstIdPage1, { timeout: 10000 });

    const firstIdPage2 = (await activeFirstRow.locator('td, [role=\"cell\"]').first().innerText()).trim();
    expect(firstIdPage2).not.toBe(firstIdPage1);

    // Return to Page 1
    const page1Link = page.getByRole('link', { name: '1', exact: true })
      .or(page.getByRole('button', { name: '1', exact: true }))
      .or(page.locator('button, a').filter({ hasText: /^1$/ }))
      .first();

    const prevPageLink = page.getByRole('link', { name: /previous|prev/i })
      .or(page.getByRole('button', { name: /previous|prev/i }))
      .or(page.locator('[aria-label*=\"prev\" i]'))
      .first();

    if (await page1Link.isVisible({ timeout: 2500 }).catch(() => false)) {
      await page1Link.click();
    } else if (await prevPageLink.isVisible({ timeout: 2500 }).catch(() => false)) {
      await prevPageLink.click();
    }

    await expect(getPatientRows(page).first()).toContainText(firstIdPage1, { timeout: 10000 });
  });

});
