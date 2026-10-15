const fs = require('fs');
const path = require('path');

// 1. Create directories
['tests/auth', 'tests/dashboard', 'tests/patients', 'utils'].forEach(dir => {
  fs.mkdirSync(dir, { recursive: true });
});

// 2. Create utils/excelReporter.js
const excelReporterContent = `const ExcelJS = require('exceljs');
const path = require('path');

async function updateExcelResult(testId, status, actualResult, executionTimeMs = 0, screenshotPath = '') {
    const filePath = path.join(__dirname, '..', 'test_cases.xlsx');
    const workbook = new ExcelJS.Workbook();

    try {
        await workbook.xlsx.readFile(filePath);
        const worksheet = workbook.getWorksheet(1);

        let rowToUpdate = null;
        worksheet.eachRow((row) => {
            const cellValue = row.getCell(1).value;
            if (cellValue && cellValue.toString().trim() === testId.trim()) {
                rowToUpdate = row;
            }
        });

        if (rowToUpdate) {
            rowToUpdate.getCell(8).value = status;
            const execDetails = "Time: " + (executionTimeMs / 1000).toFixed(2) + "s | " + actualResult + 
                                (screenshotPath ? " | Screenshot: " + screenshotPath : "");
            rowToUpdate.getCell(9).value = execDetails;

            await workbook.xlsx.writeFile(filePath);
            console.log("[Excel Updated] " + testId + " -> " + status);
        } else {
            console.warn("[Excel Warning] Test Case ID " + testId + " not found in sheet.");
        }
    } catch (error) {
        console.error("[Excel Error] " + testId + ":", error.message);
    }
}

module.exports = { updateExcelResult };
`;

fs.writeFileSync('utils/excelReporter.js', excelReporterContent);

// Helper to write individual test files
function createTestFile(folder, id, moduleName, defaultUrl) {
  const content = `const { test, expect } = require('@playwright/test');
const { updateExcelResult } = require('../../utils/excelReporter');

const TEST_ID = '${id}';

test.describe('${moduleName} - ${id}', () => {
  test('${id}: Execute Test Case', async ({ page }) => {
    const startTime = Date.now();
    try {
      await page.goto(process.env.BASE_URL + '${defaultUrl}');

      // Playwright steps go here

      const duration = Date.now() - startTime;
      await updateExcelResult(TEST_ID, 'Pass', 'Executed successfully', duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      const screenshotPath = 'screenshots/' + TEST_ID + '-failure.png';
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await updateExcelResult(TEST_ID, 'Fail', error.message.split('\\n')[0], duration, screenshotPath);
      throw error;
    }
  });
});
`;
  fs.writeFileSync(path.join(folder, id + '.spec.js'), content);
}

// 3. Generate Auth Tests (TC-AUTH-001 to TC-AUTH-010)
for (let i = 1; i <= 10; i++) {
  const id = 'TC-AUTH-' + String(i).padStart(3, '0');
  createTestFile('tests/auth', id, 'Auth Module', '');
}

// 4. Generate Dashboard Tests (TC-DASH-001 to TC-DASH-006)
for (let i = 1; i <= 6; i++) {
  const id = 'TC-DASH-' + String(i).padStart(3, '0');
  createTestFile('tests/dashboard', id, 'Dashboard Module', 'dashboard');
}

// 5. Generate Patient Tests (TC-PAT-001 to TC-PAT-005)
for (let i = 1; i <= 5; i++) {
  const id = 'TC-PAT-' + String(i).padStart(3, '0');
  createTestFile('tests/patients', id, 'Patients Module', 'patients');
}

console.log('? All folders, utils, and 21 test files created successfully!');
