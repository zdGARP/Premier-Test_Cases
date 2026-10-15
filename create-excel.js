const ExcelJS = require('exceljs');
const path = require('path');

async function buildExcel() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('TestCases');

  sheet.columns = [
    { header: 'Test Case ID', key: 'id', width: 15 },
    { header: 'Module', key: 'module', width: 15 },
    { header: 'Feature', key: 'feature', width: 20 },
    { header: 'Test Scenario', key: 'scenario', width: 40 },
    { header: 'Preconditions', key: 'preconditions', width: 20 },
    { header: 'Test Data', key: 'testData', width: 30 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Execution Details / Error / Screenshot', key: 'details', width: 60 }
  ];

  const testIds = [
    ...Array.from({ length: 10 }, (_, i) => `TC-AUTH-${String(i + 1).padStart(3, '0')}`),
    ...Array.from({ length: 6 }, (_, i) => `TC-DASH-${String(i + 1).padStart(3, '0')}`),
    ...Array.from({ length: 5 }, (_, i) => `TC-PAT-${String(i + 1).padStart(3, '0')}`)
  ];

  testIds.forEach(id => {
    let mod = 'Auth';
    if (id.startsWith('TC-DASH')) mod = 'DashBoard';
    if (id.startsWith('TC-PAT')) mod = 'Patients';

    sheet.addRow({
      id: id,
      module: mod,
      feature: 'Automated Suite',
      scenario: `Execution test for ${id}`,
      preconditions: 'Server running',
      testData: 'Synthetic Data',
      priority: 'High',
      status: 'Pending',
      details: ''
    });
  });

  const filePath = path.join(__dirname, 'test_cases.xlsx');
  await workbook.xlsx.writeFile(filePath);
  console.log('? test_cases.xlsx successfully created in project root!');
}

buildExcel();
