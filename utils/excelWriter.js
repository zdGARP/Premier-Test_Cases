const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

function updateExcel() {
  const file = path.join(__dirname, '..', 'test-data', 'testcases.xlsx');
  const resultFile = path.join(__dirname, '..', 'results', 'execution-results.json');

  if (!fs.existsSync(file)) throw new Error('Copy testcases.xlsx into test-data first.');
  if (!fs.existsSync(resultFile)) throw new Error('Run Playwright first.');

  const workbook = XLSX.readFile(file);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const results = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  const map = new Map(results.map(r => [r.testCaseId, r]));

  const updated = rows.map(row => {
    const id = String(
      row['Test Case ID'] || row['Test Case'] || row['Test Case ID ']
    ).trim();

    const result = map.get(id);
    if (!result) return row;

    return {
      ...row,
      Status: result.status,
      'Actual Result': result.actualResult,
      'Error Location': result.errorLocation,
      'Evidence / Screenshot': result.screenshotPath,
      'Executed At': result.executedAt,
      'Execution Time': result.executionTime
    };
  });

  workbook.Sheets[sheetName] = XLSX.utils.json_to_sheet(updated);
  XLSX.writeFile(workbook, file);
  console.log('Excel updated.');
}

module.exports = { updateExcel };
