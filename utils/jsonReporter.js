const fs = require('fs');
const path = require('path');

class JsonReporter {
  constructor() {
    this.results = [];
  }

  onTestEnd(test, result) {
    const match = test.title.match(/(TC-(?:PAT|APT)-\d+)/);
    if (!match) return;

    const screenshot = result.attachments.find(
      item => item.name === 'screenshot' && item.path
    );

    this.results.push({
      testCaseId: match[1],
      status: result.status === 'passed' ? 'Passed'
        : result.status === 'skipped' ? 'Not Run'
        : 'Failed',
      actualResult: result.error?.message ||
        (result.status === 'passed'
          ? 'Test assertions passed.'
          : 'Test did not complete successfully.'),
      errorLocation: result.error?.stack?.split('\n')[1]?.trim() || '',
      screenshotPath: screenshot?.path || '',
      executionTime: `${result.duration} ms`,
      executedAt: new Date().toISOString()
    });
  }

  async onEnd() {
    const output = path.join(
      process.cwd(),
      'results',
      'execution-results.json'
    );

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(this.results, null, 2));

    console.log(`Results saved to ${output}`);
  }
}

module.exports = JsonReporter;
