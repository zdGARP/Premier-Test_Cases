import { test, expect } from '@playwright/test';

test('TC-USER-001: User List Access (RBAC)', async ({ request }) => {
  const response = await request.get('/api/users');
  expect([401, 403]).toContain(response.status());
});
