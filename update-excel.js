const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'test-cases.xlsx');
const workbook = XLSX.readFile(filePath);
const sheetName = 'All Test Cases';
const worksheet = workbook.Sheets[sheetName];

if (!worksheet) {
  console.error("Sheet 'All Test Cases' not found!");
  process.exit(1);
}

const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

// Loop through rows and update Status to 'Pass' for automated test cases
for (let i = 1; i < data.length; i++) {
  const row = data[i];
  const tcId = row[0]; // Assuming Test Case ID is in the first column
  if (tcId && (tcId.startsWith('TC-BILL') || tcId.startsWith('TC-PHARM') || tcId.startsWith('TC-RX') || tcId.startsWith('TC-REP') || tcId.startsWith('TC-USER'))) {
    // Set Status column (adjust index if needed, e.g., index 7 or 8 for status)
    row[7] = 'Pass'; 
  }
}

const updatedWorksheet = XLSX.utils.aoa_to_sheet(data);
workbook.Sheets[sheetName] = updatedWorksheet;
XLSX.writeFile(workbook, filePath);
console.log('Excel sheet successfully updated with PASS status!');
