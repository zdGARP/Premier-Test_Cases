const XLSX = require('xlsx');
const path = require('path');

function readTestCases() {
  const file = path.join(__dirname, '..', 'test-data', 'testcases.xlsx');
  const workbook = XLSX.readFile(file);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

module.exports = { readTestCases };
