const { test, expect } = require('./screenshots');

test('TC-SEC-001: SQL injection payload in login email fails safely', async ({ page, request }) => {
  test.setTimeout(60000);
  const PAYLOAD = "admin' OR '1'='1' --";

  const emailInput = page.getByPlaceholder('you@hospital.com');
  const passwordInput = page.locator('input[type="password"]');
  const signIn = page.getByRole('button', { name: /^sign in$/i });

  await page.goto('/auth');
  await expect(emailInput).toBeVisible();

  // Step A: one normal failed login, only to learn the login request (address and body shape)
  const loginRequest = page.waitForRequest(
    r => r.method() === 'POST' && /\/api\//.test(r.url()),
    { timeout: 10000 }
  );
  await emailInput.fill('nobody@hospital.com');
  await passwordInput.fill('WrongPass#123');
  await signIn.click();

  const req = await loginRequest;
  let body;
  try {
    body = req.postDataJSON();
  } catch {
    body = null;
  }
  expect(body, `Login request is not JSON, send me this: ${req.postData()}`).not.toBeNull();
  const emailKey = Object.keys(body).find(k => body[k] === 'nobody@hospital.com') || 'email';
  console.log(`Login endpoint: ${req.url()}  (email field: "${emailKey}")`);

  // Step B: send the same request with the SQL injection payload as the email
  const injected = await request.post(req.url(), { data: { ...body, [emailKey]: PAYLOAD } });
  const injectedText = await injected.text();
  console.log(`Injection response: ${injected.status()} ${injectedText}`);

  test.skip(injected.status() === 429, 'Rate limited, wait 15 minutes and rerun');

  // 1. The login is rejected (client error), not accepted and not a server crash
  expect(
    [400, 401, 403, 422],
    `Unexpected status ${injected.status()}: ${injectedText}`
  ).toContain(injected.status());

  // 2. No login token or session data is returned
  expect(injectedText.toLowerCase(), 'A token was returned for the injection payload').not.toMatch(
    /"(access_?token|token|jwt|refresh_?token|session)"/i
  );

  // 3. No database error details are leaked
  expect(injectedText.toLowerCase(), 'Response leaks database or server error details').not.toMatch(
    /sql|syntax error|sqlite|postgres|pg_|mysql|unterminated|stack|exception|\.js:\d+/
  );

  // Step C: the same payload typed into the real login form (for the screenshot and UI behaviour)
  await page.goto('/auth');
  await emailInput.fill(PAYLOAD);
  await passwordInput.fill('anything');
  await signIn.click();
  await page.waitForTimeout(2500);

  const blockedByBrowser = await emailInput.evaluate(el => !el.validity.valid);
  console.log(
    blockedByBrowser
      ? 'The browser blocked the payload on the form (email format check), so the request was never sent from the UI'
      : 'The form sent the payload to the server'
  );

  // 4. The user is not logged in and stays on the login page
  await expect(page).toHaveURL(/\/auth/);
  await expect(page.getByText('Dashboard', { exact: true })).toHaveCount(0);

  // 5. No database error text is shown on screen
  const screenText = (await page.locator('body').innerText()).toLowerCase();
  expect(screenText, 'Database error text is visible on the page').not.toMatch(
    /sql|syntax error|sqlite|postgres|mysql|unterminated|stack trace|exception/
  );
});

test('TC-SEC-002: SQL injection in patient search parameter fails safely', async ({ page, request }) => {
  test.setTimeout(90000);
  const PAYLOAD = "' UNION SELECT username, password, NULL FROM users --";

  // Collect every API GET request the app makes, to learn the patient search request
  const seen = [];
  page.on('request', r => {
    if (r.method() === 'GET' && r.url().includes('/api/')) seen.push(r);
  });

  // Log in (authenticated user)
  await page.goto('/auth');
  await page.getByPlaceholder('you@hospital.com').fill(process.env.TEST_EMAIL);
  await page.locator('input[type="password"]').fill(process.env.TEST_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page, 'Login failed, check TEST_EMAIL and TEST_PASSWORD in .env').not.toHaveURL(/\/auth/, {
    timeout: 15000,
  });

  // Open the Patients page and find the search box
  await page.getByRole('link', { name: /^patients$/i }).first().click();
  await page.waitForLoadState('networkidle');
  const search = page.getByPlaceholder(/search/i).first();
  await expect(search, 'Patient search box not found').toBeVisible();

  // Type a normal search to see which request the page sends
  const before = seen.length;
  await search.fill('Test');
  await page.waitForTimeout(2500);

  const PARAM_RE = /[?&](q|search|query|term|keyword)=/;
  let template = seen.slice(before).find(r => /patient/i.test(r.url()) && PARAM_RE.test(r.url()));
  let usedFallback = false;
  if (!template) {
    // The search may run in the browser: fall back to the patient list request and add q to it
    template = [...seen].reverse().find(r => /\/api\/[^?]*patients?(\?|$)/i.test(r.url()));
    usedFallback = true;
  }
  expect(
    template,
    'Could not find a patient request. API calls seen:\n' + seen.map(r => r.url()).join('\n')
  ).toBeTruthy();

  const param = (template.url().match(PARAM_RE) || [])[1] || 'q';
  const skip = ['host', 'connection', 'content-length', 'accept-encoding'];
  const headers = Object.fromEntries(
    Object.entries(await template.allHeaders()).filter(([k]) => !skip.includes(k.toLowerCase()))
  );
  const buildUrl = value => {
    const u = new URL(template.url());
    u.searchParams.set(param, value);
    return u.toString();
  };
  console.log(`Patient request: ${template.url()}`);
  console.log(`Search parameter: "${param}"${usedFallback ? '  (the page search runs in the browser, so "q" was added to the list request)' : ''}`);

  // Control: a normal search with the same login works, so the test is really authenticated
  const normal = await request.get(buildUrl('Test'), { headers });
  expect(normal.status(), `Control search failed (${normal.status()}), login headers were not captured`).toBe(200);

  // The injection request
  const injected = await request.get(buildUrl(PAYLOAD), { headers });
  const injectedText = await injected.text();
  console.log(`Injection response: ${injected.status()} ${injectedText.slice(0, 500)}`);

  test.skip(injected.status() === 429, 'Rate limited, wait 15 minutes and rerun');

  // 1. The server handles the payload safely: no crash (500) and no data leak
  expect(
    [200, 400, 422],
    `Unexpected status ${injected.status()}: ${injectedText.slice(0, 300)}`
  ).toContain(injected.status());

  // Remove the echoed payload before checking the text (a server may repeat what was sent)
  const cleaned = injectedText.split(PAYLOAD).join('').toLowerCase();

  // 2. No database error details are leaked
  expect(cleaned, 'Response leaks database or server error details').not.toMatch(
    /sql|syntax error|sqlite|postgres|pg_|mysql|unterminated|exception|stack|\.js:\d+/
  );

  // 3. No credentials from another table are returned
  expect(cleaned, 'Response contains password or hash data').not.toMatch(
    /password|passwd|hash|bcrypt|\$2[aby]\$/
  );

  // 4. Any rows returned are patient records only (nothing from the UNION)
  if (injected.status() === 200) {
    const json = JSON.parse(injectedText);
    const findRows = node => {
      if (Array.isArray(node)) return node;
      if (node && typeof node === 'object') {
        for (const v of Object.values(node)) {
          const found = findRows(v);
          if (found) return found;
        }
      }
      return null;
    };
    const rows = (findRows(json) || []).filter(x => x && typeof x === 'object');
    console.log(`Rows returned for the injection: ${rows.length}`);
    for (const row of rows) {
      expect(
        'full_name' in row || 'first_name' in row || 'patient_id' in row,
        `A returned row does not look like a patient record: ${JSON.stringify(row).slice(0, 200)}`
      ).toBe(true);
    }
  }

  // 5. The same payload typed into the real search box: the page keeps working
  await search.fill(PAYLOAD);
  await page.waitForTimeout(2500);
  await expect(page).not.toHaveURL(/\/auth/);
  const screenText = (await page.locator('body').innerText()).toLowerCase();
  expect(screenText, 'Database error text is visible on the page').not.toMatch(
    /syntax error|sqlite|postgres|mysql|unterminated|stack trace|exception/
  );
});

test('TC-SEC-003: Stored XSS - script tags in patient name do not execute in DOM', async ({ page, request }) => {
  test.setTimeout(120000);
  const PAYLOAD = "<script>alert('XSS')</script>";
  const BRANCH = 'Kodambakkam';
  const BOOKING = '/api/appointments/public/qr';

  const randomPhone = prefix => prefix + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const date = d.toISOString().split('T')[0];

  // Watch for any alert / confirm / prompt pop-up (this is what the payload tries to trigger)
  const dialogs = [];
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  // Step 1: store the payload as a patient name (public booking endpoint)
  const POOL = ['08:00', '08:15', '08:30', '08:45', '09:00', '09:15', '09:30', '09:45', '10:00', '10:15',
    '13:00', '13:15', '13:30', '13:45', '14:00', '14:15', '14:30', '14:45', '15:00', '15:15', '16:00', '16:15'];
  const start = POOL[Math.floor(Math.random() * POOL.length)];
  const [h, m] = start.split(':').map(Number);
  const end = `${String(Math.floor((h * 60 + m + 15) / 60)).padStart(2, '0')}:${String((m + 15) % 60).padStart(2, '0')}`;

  const payload = {
    appointment: {
      branch: BRANCH, appointment_date: date, start_time: start, end_time: end,
      type: 'consultation', reason: 'Initial consultation & assessment',
    },
    patient: {
      title: 'Mrs', first_name: 'Xss', last_name: 'Test', full_name: PAYLOAD,
      age: 20, date_of_birth: '2006-01-22', gender: 'female', phone: randomPhone('9'),
      purpose: 'Fertility Consultation', referral_source: 'Google', branch: BRANCH,
    },
    partner: {
      title: 'Mr', first_name: 'Xsspartner', last_name: 'Test', full_name: 'Mr Xsspartner Test',
      age: 20, date_of_birth: '2005-10-20', gender: 'female', phone: randomPhone('7'),
      purpose: 'Fertility Consultation', referral_source: 'Google', branch: BRANCH,
    },
    website: '',
  };

  let res = await request.post(BOOKING, { data: payload });
  if (res.status() === 409) res = await request.post(BOOKING, { data: payload }); // known first-submit bug (TC-QR-002)
  const resText = await res.text();
  console.log(`Store response: ${res.status()} ${resText.slice(0, 400)}`);

  test.skip(res.status() === 429, 'Rate limited, wait 15 minutes and rerun');

  // The server may refuse the payload. That is also a safe result: nothing is stored.
  if (res.status() === 400 || res.status() === 422) {
    test.info().annotations.push({
      type: 'note',
      description: 'Server rejected the script tags in the name (input validation). Nothing was stored.',
    });
    console.log('RESULT: the server rejected the payload, so it cannot be stored. Safe.');
    return;
  }
  expect(res.status(), `Could not store the patient: ${resText.slice(0, 300)}`).toBe(201);

  const { data } = JSON.parse(resText);
  const patientId = data.patient.patient_id;
  console.log(`Stored patient ${patientId}, full_name saved as: ${data.patient.full_name}`);
  console.log(
    data.patient.full_name === PAYLOAD
      ? 'The server saved the name as it was sent, so the page must show it safely'
      : 'The server changed the name before saving (cleaned)'
  );

  // Step 2: log in as staff
  await page.goto('/auth');
  await page.getByPlaceholder('you@hospital.com').fill(process.env.TEST_EMAIL);
  await page.locator('input[type="password"]').fill(process.env.TEST_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page, 'Login failed, check TEST_EMAIL and TEST_PASSWORD in .env').not.toHaveURL(/\/auth/, {
    timeout: 15000,
  });

  // Counts script elements in the page that contain the payload text
  const injectedScripts = () =>
    page.locator('script').evaluateAll(list => list.filter(s => (s.textContent || '').includes("alert('XSS')")).length);

  // Step 3a: Appointments page (shows patient names)
  await page.getByRole('link', { name: /^appointments$/i }).first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  expect(await injectedScripts(), 'A script element built from the name is in the Appointments page').toBe(0);

  // Step 3b: Patients page - search for the new patient by ID so its row is on screen
  await page.getByRole('link', { name: /^patients$/i }).first().click();
  await page.waitForLoadState('networkidle');
  const search = page.getByPlaceholder(/search/i).first();
  await expect(search, 'Patient search box not found').toBeVisible();
  await search.fill(patientId);
  await page.waitForTimeout(2500);

  // Control: the new patient's row is shown, so the test really looked at the stored name
  await expect(page.getByText(patientId).first(), `Patient ${patientId} not shown in the list`).toBeVisible();

  // How the name is displayed
  const bodyText = await page.locator('body').innerText();
  console.log(
    bodyText.includes(PAYLOAD)
      ? 'DISPLAY: the name is shown as plain text (escaped). Safe.'
      : 'DISPLAY: the raw script text is not shown (cleaned, or shown in a different form).'
  );

  // 1. No script element was created from the stored name
  expect(await injectedScripts(), 'A script element built from the name is in the Patients page').toBe(0);

  // 2. The script did not run: no pop-up appeared on any page
  expect(dialogs, `The script ran! Pop-up messages: ${dialogs.join(', ')}`).toEqual([]);
});

const { Client } = require('pg');

test('TC-SEC-004: Passwords are stored using bcrypt with at least 10 salt rounds', async ({ page }) => {
  test.setTimeout(60000);

  // ---- CHANGE THESE IF YOUR TABLE OR COLUMN NAMES DIFFER ----
  const USERS_TABLE = 'users';
  const EMAIL_COLUMN = 'email';
  const HASH_COLUMN = 'password_hash';
  const CREATED_COLUMN = 'created_at';
  const MIN_ROUNDS = 10;

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 8000,
  });

  let rows;
  try {
    try {
      await client.connect();
    } catch (e) {
      throw new Error(`Cannot connect to the database (${e.message}). Check DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASSWORD in .env`);
    }
    const res = await client.query(
      `SELECT ${EMAIL_COLUMN} AS email, ${HASH_COLUMN} AS hash FROM ${USERS_TABLE} ORDER BY ${CREATED_COLUMN} DESC`
    );
    rows = res.rows;
  } finally {
    await client.end().catch(() => {});
  }

  expect(rows.length, `No users found in table "${USERS_TABLE}"`).toBeGreaterThan(0);

  // bcrypt format: $2a$ / $2b$ / $2y$, two-digit cost, then 53 characters
  const BCRYPT = /^\$(2[aby])\$(\d{2})\$[./A-Za-z0-9]{53}$/;
  const results = rows.map(r => {
    const m = typeof r.hash === 'string' ? r.hash.match(BCRYPT) : null;
    return { email: r.email, isBcrypt: !!m, variant: m ? m[1] : '-', rounds: m ? Number(m[2]) : 0 };
  });

  // Print results without ever printing the hashes themselves
  console.log(
    'USERS CHECKED (newest first):\n' +
      results
        .map(r => `${r.email}  |  ${r.isBcrypt ? `bcrypt $${r.variant}$` : 'NOT bcrypt'}  |  rounds: ${r.rounds}`)
        .join('\n')
  );

  // Evidence for the screenshot (no hashes shown)
  await page.setContent(`
    <body style="font-family:sans-serif;padding:16px">
      <h3>TC-SEC-004 - password storage check</h3>
      <table border="1" cellpadding="6" style="border-collapse:collapse">
        <tr><th>User</th><th>Algorithm</th><th>Rounds</th><th>Result</th></tr>
        ${results
          .map(r => {
            const ok = r.isBcrypt && r.rounds >= MIN_ROUNDS;
            return `<tr><td>${r.email}</td><td>${r.isBcrypt ? 'bcrypt' : 'NOT bcrypt'}</td><td>${r.rounds}</td><td>${ok ? 'PASS' : 'FAIL'}</td></tr>`;
          })
          .join('')}
      </table>
    </body>`);

  // 1. The newest (newly created) user has a bcrypt hash with at least 10 rounds
  const newest = results[0];
  expect(newest.isBcrypt, `Newest user (${newest.email}) password is not stored as a bcrypt hash`).toBe(true);
  expect(newest.rounds, `Newest user (${newest.email}) uses only ${newest.rounds} rounds`).toBeGreaterThanOrEqual(MIN_ROUNDS);

  // 2. Every user in the table is stored the same safe way
  const notBcrypt = results.filter(r => !r.isBcrypt).map(r => r.email);
  expect(notBcrypt, 'These users do not have a bcrypt password hash').toEqual([]);
  const weak = results.filter(r => r.isBcrypt && r.rounds < MIN_ROUNDS).map(r => `${r.email} (${r.rounds})`);
  expect(weak, `These users have fewer than ${MIN_ROUNDS} rounds`).toEqual([]);
});

test('TC-SEC-005: Password hash is omitted in user queries and API responses', async ({ page }) => {
  test.setTimeout(120000);

  const KEY_RE = /pass(word)?|passwd|pwd|hash|salt|secret/i;
  const BCRYPT_RE = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/;

  const checked = []; // { label, status }
  const findings = []; // real leaks (never prints the values themselves)
  const notes = []; // sensitive-looking field names with no value (information only)
  const seenKeys = new Set();

  const scanJson = (label, node, path = '') => {
    if (Array.isArray(node)) {
      node.forEach(v => scanJson(label, v, path + '[]'));
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const p = path ? `${path}.${k}` : k;
        if (KEY_RE.test(k)) {
          const id = `${label}|${p}`;
          if (!seenKeys.has(id)) {
            seenKeys.add(id);
            if (typeof v === 'string' && v.length > 0) findings.push(`${label}: field "${p}" contains a value`);
            else notes.push(`${label}: field "${p}" exists but is empty or not text`);
          }
        }
        scanJson(label, v, p);
      }
    }
  };
  const scan = (label, status, text) => {
    checked.push({ label, status });
    if (BCRYPT_RE.test(text)) findings.push(`${label}: contains a bcrypt hash value`);
    try {
      scanJson(label, JSON.parse(text));
    } catch {}
  };

  // Collect every API request and response the app makes
  const seen = [];
  page.on('request', r => {
    if (r.method() === 'GET' && r.url().includes('/api/')) seen.push(r);
  });
  page.on('response', async res => {
    if (!res.url().includes('/api/')) return;
    if (!(res.headers()['content-type'] || '').includes('json')) return;
    try {
      scan(`${res.request().method()} ${new URL(res.url()).pathname}`, res.status(), await res.text());
    } catch {}
  });

  // Log in as admin (the response of the login itself is checked too)
  await page.goto('/auth');
  await page.getByPlaceholder('you@hospital.com').fill(process.env.TEST_EMAIL);
  await page.locator('input[type="password"]').fill(process.env.TEST_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page, 'Login failed, check TEST_EMAIL and TEST_PASSWORD in .env').not.toHaveURL(/\/auth/, {
    timeout: 15000,
  });
  await page.waitForLoadState('networkidle');

  // Browse a few pages so the app's own API responses are checked as well
  for (const name of ['Patients', 'Doctors', 'Appointments']) {
    const item = page.locator('a, button').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`, 'i') }).first();
    if (await item.count()) {
      await item.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    } else {
      console.log(`Menu item "${name}" not found, skipped`);
    }
  }

  // Reuse the headers the app sent on its own API calls (the browser session carries the login)
  expect(seen.length, 'The app made no API requests after login, so nothing could be checked').toBeGreaterThan(0);
  const last = seen[seen.length - 1];
  const skip = ['host', 'connection', 'content-length', 'accept-encoding', 'cookie'];
  const headers = Object.fromEntries(
    Object.entries(await last.allHeaders()).filter(([k]) => !skip.includes(k.toLowerCase()) && !k.startsWith(':'))
  );
  console.log(`API requests seen: ${seen.length}`);
  console.log(`Header names the app sends: ${Object.keys(await last.allHeaders()).join(', ')}`);

  const call = async (path, label) => {
    const res = await page.request.get(path, { headers });
    const text = await res.text();
    scan(`${label} (direct)`, res.status(), text);
    return { status: res.status(), text };
  };

  // The request from the test case: GET /api/users as admin
  const users = await call('/api/users', 'GET /api/users');
  test.skip(users.status === 429, 'Rate limited, wait 15 minutes and rerun');
  expect(
    users.status,
    `GET /api/users returned ${users.status}. 401/403: is TEST_EMAIL really an admin? 404: the path is different`
  ).toBe(200);

  // User queries: by email, and one user by id
  await call(`/api/users?email=${encodeURIComponent(process.env.TEST_EMAIL)}`, 'GET /api/users?email=');
  const findRows = node => {
    if (Array.isArray(node)) return node;
    if (node && typeof node === 'object') {
      for (const v of Object.values(node)) {
        const found = findRows(v);
        if (found) return found;
      }
    }
    return null;
  };
  const rows = findRows(JSON.parse(users.text)) || [];
  console.log(`Users returned by GET /api/users: ${rows.length}`);
  expect(rows.length, 'GET /api/users returned no users, so there is nothing to check').toBeGreaterThan(0);
  for (const row of rows.slice(0, 3)) {
    if (row && row.id) await call(`/api/users/${row.id}`, 'GET /api/users/:id');
  }

  // Report (paths only, the values are never printed)
  console.log(`API responses checked: ${checked.length}`);
  console.log([...new Set(checked.map(c => `${c.label} -> ${c.status}`))].join('\n'));
  if (notes.length) console.log('INFORMATION (sensitive-looking field names without a value):\n' + notes.join('\n'));
  if (findings.length) console.log('LEAKS FOUND:\n' + findings.join('\n'));

  // Evidence for the screenshot (no values)
  await page.setContent(`
    <body style="font-family:sans-serif;padding:16px">
      <h3>TC-SEC-005 - password data in API responses</h3>
      <p>Responses checked: ${checked.length}</p>
      <ul>${[...new Set(checked.map(c => `${c.label} -> ${c.status}`))].map(t => `<li>${t.replace(/</g, '&lt;')}</li>`).join('')}</ul>
      <h4>Result: ${findings.length ? 'FAIL - ' + findings.length + ' leak(s)' : 'PASS - no password or hash data found'}</h4>
      <ul>${findings.map(f => `<li>${f.replace(/</g, '&lt;')}</li>`).join('')}</ul>
    </body>`);

  // 1. No password hash or other password data is returned anywhere
  expect(findings, 'Password data found in API responses').toEqual([]);
});

test('TC-SEC-006: Helmet middleware attaches security headers to HTTP responses', async ({ page, request }) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const date = d.toISOString().split('T')[0];

  // Headers Helmet sets by default: [name, expected value pattern or null for "any value"]
  const REQUIRED = [
    ['content-security-policy', null],
    ['strict-transport-security', /max-age=\d+/i],
    ['x-content-type-options', /^nosniff$/i],
    ['x-frame-options', /^(DENY|SAMEORIGIN)$/i],
    ['referrer-policy', null],
    ['cross-origin-opener-policy', null],
    ['cross-origin-resource-policy', null],
    ['x-dns-prefetch-control', null],
    ['origin-agent-cluster', null],
    ['x-permitted-cross-domain-policies', null],
  ];
  // Depends on the Helmet version, so shown for information only
  const OPTIONAL = ['x-download-options', 'x-xss-protection'];

  const targets = [
    { label: 'GET /  (web page)', path: '/' },
    { label: 'GET /api/...  (API)', path: `/api/appointments/public/availability?branch=Kodambakkam&date=${date}` },
  ];

  const results = [];
  for (const t of targets) {
    const res = await request.get(t.path);
    const headers = res.headers(); // names are lower case
    console.log(`\n${t.label} -> ${res.status()}\n` + Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`).join('\n'));

    if (res.status() === 429) {
      test.info().annotations.push({ type: 'note', description: `${t.label} skipped: rate limited (429)` });
      console.log(`${t.label} skipped: rate limited, wait 15 minutes and rerun`);
      continue;
    }

    const missing = [];
    const badValue = [];
    for (const [name, pattern] of REQUIRED) {
      if (!(name in headers)) missing.push(name);
      else if (pattern && !pattern.test(headers[name])) badValue.push(`${name}: ${headers[name]}`);
    }
    results.push({
      ...t,
      status: res.status(),
      headers,
      missing,
      badValue,
      poweredBy: headers['x-powered-by'] || null,
      server: headers['server'] || null,
      optionalMissing: OPTIONAL.filter(n => !(n in headers)),
    });
  }

  // Evidence for the screenshot
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  await page.setContent(`
    <body style="font-family:sans-serif;padding:16px;font-size:13px">
      <h3>TC-SEC-006 - security headers</h3>
      ${results
        .map(
          r => `
        <h4>${esc(r.label)} - status ${r.status} - ${r.missing.length || r.badValue.length || r.poweredBy ? 'FAIL' : 'PASS'}</h4>
        <table border="1" cellpadding="4" style="border-collapse:collapse">
          ${REQUIRED.map(([name]) => {
            const v = r.headers[name];
            return `<tr><td>${name}</td><td>${v ? 'present' : 'MISSING'}</td><td>${v ? esc(v.slice(0, 70)) : ''}</td></tr>`;
          }).join('')}
          <tr><td>x-powered-by</td><td>${r.poweredBy ? 'EXPOSED' : 'removed'}</td><td>${esc(r.poweredBy || '')}</td></tr>
        </table>`
        )
        .join('')}
    </body>`);

  expect(results.length, 'No response could be checked (rate limited?)').toBeGreaterThan(0);

  for (const r of results) {
    if (r.optionalMissing.length) console.log(`${r.label}: not present (depends on Helmet version): ${r.optionalMissing.join(', ')}`);
    if (r.server) console.log(`${r.label}: Server header shows "${r.server}"`);

    // 1. Every default Helmet header is present
    expect.soft(r.missing, `${r.label}: missing security headers`).toEqual([]);
    // 2. The important values are safe
    expect.soft(r.badValue, `${r.label}: weak or unexpected header values`).toEqual([]);
    // 3. X-Powered-By is removed
    expect.soft(r.poweredBy, `${r.label}: X-Powered-By is exposed`).toBeNull();
  }
});

test('TC-SEC-007: Disallowed origin is rejected by the CORS policy', async ({ page, request }) => {
  test.setTimeout(60000);
  const EVIL = 'http://malicious-site.com';
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  const ownOrigin = new URL(base).origin;

  const d = new Date();
  d.setDate(d.getDate() + 1);
  const date = d.toISOString().split('T')[0];
  const getPath = `/api/appointments/public/availability?branch=Kodambakkam&date=${date}`;
  const preflightPath = '/api/appointments/public/qr';

  const cors = h => ({
    allowOrigin: h['access-control-allow-origin'] ?? null,
    allowCredentials: h['access-control-allow-credentials'] ?? null,
    allowMethods: h['access-control-allow-methods'] ?? null,
  });

  // 1. Normal request from the disallowed origin
  const evilGet = await request.get(getPath, { headers: { Origin: EVIL } });
  test.skip(evilGet.status() === 429, 'Rate limited, wait 15 minutes and rerun');
  const evil = cors(evilGet.headers());
  console.log(`1) GET with Origin ${EVIL} -> ${evilGet.status()}  ${JSON.stringify(evil)}`);

  // 2. Preflight (the browser's permission check before a cross-site POST)
  const pre = await request.fetch(preflightPath, {
    method: 'OPTIONS',
    headers: {
      Origin: EVIL,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  const preflight = cors(pre.headers());
  console.log(`2) Preflight from ${EVIL} -> ${pre.status()}  ${JSON.stringify(preflight)}`);

  // Control (information only): the app's own origin
  const ownGet = await request.get(getPath, { headers: { Origin: ownOrigin } });
  console.log(`   For comparison, GET with Origin ${ownOrigin} -> ${ownGet.status()}  ${JSON.stringify(cors(ownGet.headers()))}`);

  // 3. Real browser: a fake page on the disallowed origin tries to read the API
  await page.route(`${EVIL}/**`, route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="font-family:sans-serif"><h3>Test page pretending to be http://malicious-site.com</h3></body></html>',
    })
  );
  await page.goto(`${EVIL}/`);
  const outcome = await page.evaluate(async url => {
    try {
      const r = await fetch(url);
      return { readable: true, status: r.status };
    } catch (e) {
      return { readable: false, error: String(e) };
    }
  }, `${base}${getPath}`);
  console.log(`3) Browser read from ${EVIL}: ${outcome.readable ? 'ALLOWED (status ' + outcome.status + ')' : 'BLOCKED (' + outcome.error + ')'}`);

  // Evidence for the screenshot
  await page.evaluate(text => {
    const pre = document.createElement('pre');
    pre.textContent = text;
    document.body.appendChild(pre);
  }, [
    `1) GET with Origin ${EVIL}: status ${evilGet.status()}`,
    `   Access-Control-Allow-Origin: ${evil.allowOrigin ?? '(not sent)'}`,
    `   Access-Control-Allow-Credentials: ${evil.allowCredentials ?? '(not sent)'}`,
    `2) Preflight: status ${pre.status()}, Allow-Origin: ${preflight.allowOrigin ?? '(not sent)'}`,
    `3) Browser read: ${outcome.readable ? 'ALLOWED - FAIL' : 'BLOCKED - PASS'}`,
  ].join('\n'));

  // Check 1: the disallowed origin is not allowed
  expect.soft(evil.allowOrigin, 'Server allows the malicious origin (echoed it back)').not.toBe(EVIL);
  expect.soft(evil.allowOrigin, 'Server allows every origin (*)').not.toBe('*');
  expect.soft(
    evil.allowOrigin ? evil.allowCredentials : null,
    'Malicious origin is allowed together with credentials'
  ).not.toBe('true');

  // Check 2: the preflight does not grant permission
  expect.soft(preflight.allowOrigin, 'Preflight allows the malicious origin').not.toBe(EVIL);
  expect.soft(preflight.allowOrigin, 'Preflight allows every origin (*)').not.toBe('*');

  // Check 3: a real browser cannot read the response
  expect(outcome.readable, 'The browser could read the API response from the malicious origin').toBe(false);
});

test('TC-SEC-008: Global rate limiter prevents API flooding', async ({ page, request }) => {
  test.setTimeout(180000);
  const TOTAL = 150;
  const BATCH = 10; // requests sent at the same time

  const d = new Date();
  d.setDate(d.getDate() + 1);
  const date = d.toISOString().split('T')[0];
  const availabilityPath = `/api/appointments/public/availability?branch=Kodambakkam&date=${date}`;

  // Find a public API endpoint other than availability (that one has its own limit of 20)
  const apiGets = [];
  page.on('request', r => {
    if (r.method() === 'GET' && r.url().includes('/api/')) apiGets.push(new URL(r.url()));
  });
  await page.goto('/premier-plus-qr');
  await page.waitForLoadState('networkidle');

  const candidates = apiGets.filter(u => !/availability/.test(u.pathname));
  const preferred = candidates.find(u => /branches|hospital/.test(u.pathname)) || candidates[0];
  let path = preferred ? preferred.pathname + preferred.search : availabilityPath;

  // Probe once: it must be a public endpoint that answers 200
  const probe = await request.get(path);
  if (probe.status() !== 200) {
    console.log(`${path} answered ${probe.status()}, using the availability endpoint instead`);
    path = availabilityPath;
  }
  console.log(`Flood target: GET ${path}`);

  // Send 150 requests quickly, 10 at a time
  const statuses = [];
  let firstHeaders = null;
  let first429 = null;
  const started = Date.now();
  for (let i = 0; i < TOTAL; i += BATCH) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(BATCH, TOTAL - i) }, () => request.get(path))
    );
    for (const res of batch) {
      statuses.push(res.status());
      if (!firstHeaders && res.status() === 200) firstHeaders = res.headers();
      if (res.status() === 429 && !first429) {
        first429 = { headers: res.headers(), body: (await res.text()).slice(0, 200) };
      }
    }
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const counts = {};
  statuses.forEach(s => (counts[s] = (counts[s] || 0) + 1));
  const firstBlockedAt = statuses.indexOf(429) + 1; // 1-based, 0 if never
  console.log(`Sent ${statuses.length} requests in ${seconds}s. Results: ${JSON.stringify(counts)}`);
  console.log(firstBlockedAt ? `First 429 at request number ${firstBlockedAt}` : 'No 429 was returned');
  if (firstHeaders) {
    console.log(`Limit headers on a normal response: ${JSON.stringify(
      Object.fromEntries(Object.entries(firstHeaders).filter(([k]) => /ratelimit|retry-after/i.test(k))))}`);
  }
  if (first429) {
    console.log(`429 response headers: ${JSON.stringify(
      Object.fromEntries(Object.entries(first429.headers).filter(([k]) => /ratelimit|retry-after|content-type/i.test(k))))}`);
    console.log(`429 response body: ${first429.body}`);
  }

  // Information: after the flood, is a different endpoint blocked too? (a global limiter would block it)
  const other = path === availabilityPath ? '/api/branches' : availabilityPath;
  const otherRes = await request.get(other);
  console.log(`After the flood, GET ${other} -> ${otherRes.status()}  (429 here means the limit covers the whole API)`);

  // Evidence for the screenshot
  await page.setContent(`
    <body style="font-family:sans-serif;padding:16px">
      <h3>TC-SEC-008 - global rate limiter</h3>
      <p>Target: GET ${path.replace(/</g, '&lt;')}</p>
      <p>${statuses.length} requests sent in ${seconds}s</p>
      <table border="1" cellpadding="6" style="border-collapse:collapse">
        <tr><th>Status</th><th>Count</th></tr>
        ${Object.entries(counts).map(([s, c]) => `<tr><td>${s}</td><td>${c}</td></tr>`).join('')}
      </table>
      <h4>${firstBlockedAt ? `First blocked at request ${firstBlockedAt}: limiter works - PASS` : 'No request was blocked - FAIL'}</h4>
    </body>`);

  // If the limit was already used up before the test began, the result cannot show the threshold
  test.skip(statuses[0] === 429, 'Already rate limited before the test started. Wait 15 minutes and rerun.');

  // 1. The limiter triggers: some requests are refused with 429
  expect(
    statuses.includes(429),
    `All ${TOTAL} rapid requests were accepted. Status counts: ${JSON.stringify(counts)}`
  ).toBe(true);

  // 2. The limiter blocks before all 150 are used
  expect(firstBlockedAt, 'The limit only started after the 150th request').toBeLessThan(TOTAL);

  // 3. The server survives the flood (no 5xx errors)
  expect(statuses.filter(s => s >= 500), 'The server returned 5xx errors under load').toEqual([]);

  // 4. The 429 tells the client when to retry (soft check)
  const h = first429.headers;
  expect.soft(
    h['retry-after'] || h['ratelimit-reset'] || h['x-ratelimit-reset'],
    'The 429 response has no retry-after or ratelimit-reset header'
  ).toBeTruthy();
});

