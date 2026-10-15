const { test, expect } = require('./screenshots');

const ENDPOINT = '/api/appointments/public/availability';
const BRANCH = 'Kodambakkam';

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

test('TC-QR-001: Public availability endpoint returns available 15-min slots', async ({ page, request }) => {
  const date = getTomorrow();

  // Open the endpoint in the browser so the screenshot shows the response
  await page.goto(`${ENDPOINT}?branch=${BRANCH}&date=${date}`);

  // 1. Public endpoint responds successfully (no login used)
  const response = await request.get(ENDPOINT, {
    params: { branch: BRANCH, date },
  });
  expect(response.status()).toBe(200);

  const { data } = await response.json();

  // 2. Response is for the requested branch and date, with 15-minute slots
  expect(data.branch).toBe(BRANCH);
  expect(data.date).toBe(date);
  expect(data.slot_minutes).toBe(15);

  // 3. Available slots are returned
  expect(Array.isArray(data.slots)).toBe(true);
  expect(data.slots.length).toBeGreaterThan(0);

  // 4. Every slot is exactly 15 minutes long and starts on a 15-minute mark
  for (const slot of data.slots) {
    const start = toMinutes(slot.start_time);
    const end = toMinutes(slot.end_time);
    expect(end - start).toBe(15);
    expect(start % 15).toBe(0);
  }
});

const BOOKING_ENDPOINT = '/api/appointments/public/qr';

// random 10-digit phone number so every run uses a new one
function randomPhone(prefix) {
  return prefix + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
}

test('TC-QR-002: Public QR booking registers patient and books appointment in one transaction', async ({ page, request }) => {
  const date = getTomorrow();

  // Pick a free slot from the availability endpoint
  const availRes = await request.get(ENDPOINT, { params: { branch: BRANCH, date } });
  expect(availRes.status()).toBe(200);
  const { data: avail } = await availRes.json();
  expect(avail.slots.length).toBeGreaterThan(0);
  const slot = avail.slots[Math.floor(Math.random() * avail.slots.length)];

  const payload = {
    appointment: {
      branch: BRANCH,
      appointment_date: date,
      start_time: slot.start_time,
      end_time: slot.end_time,
      type: 'consultation',
      reason: 'Initial consultation & assessment',
    },
    patient: {
      title: 'Mrs',
      first_name: 'Auto',
      last_name: 'Test',
      full_name: 'Mrs Auto Test',
      age: 20,
      date_of_birth: '2006-01-22',
      gender: 'female',
      phone: randomPhone('9'),
      purpose: 'Fertility Consultation',
      referral_source: 'Google',
      branch: BRANCH,
    },
    partner: {
      title: 'Mr',
      first_name: 'Partner',
      last_name: 'Test',
      full_name: 'Mr Partner Test',
      age: 20,
      date_of_birth: '2005-10-20',
      gender: 'female', // same as the working browser request
      phone: randomPhone('7'),
      purpose: 'Fertility Consultation',
      referral_source: 'Google',
      branch: BRANCH,
    },
    website: '', // honeypot field, must stay empty
  };

  // 1. First submission (public, no login)
  let response = await request.post(BOOKING_ENDPOINT, { data: payload });
  let bodyText = await response.text();
  const firstStatus = response.status();
  const firstBody = bodyText;

  // 2. If it fails, record it as a bug and retry once (same as the "Retry Submission" button)
  if (firstStatus !== 201) {
    test.info().annotations.push({
      type: 'bug',
      description: `First submit returned ${firstStatus}: ${firstBody}`,
    });
    response = await request.post(BOOKING_ENDPOINT, { data: payload });
    bodyText = await response.text();
  }

  // Show both responses on the page so the screenshot has evidence
  const esc = s => s.replace(/</g, '&lt;');
  await page.setContent(
    `<pre style="font-size:14px">FIRST ATTEMPT (${firstStatus}):\n${esc(firstBody)}\n\nFINAL RESULT (${response.status()}):\n${esc(bodyText)}</pre>`
  );

  // The first attempt should succeed. This is a soft check: if it fails the test is
  // marked failed, but the checks below still run.
  expect.soft(firstStatus, `First submit: ${firstBody}`).toBe(201);

  expect(response.status(), bodyText).toBe(201);
  const { data } = JSON.parse(bodyText);

  // 3. Appointment was booked for the chosen branch, date and slot
  expect(data.appointment.branch).toBe(BRANCH);
  expect(data.appointment.appointment_date).toBe(date);
  expect(data.appointment.start_time).toBe(slot.start_time);
  expect(data.appointment.end_time).toBe(slot.end_time);
  expect(data.appointment.status).toBe('pending');
  expect(data.appointment.type).toBe('consultation');

  // 4. Patient was registered in the same transaction
  expect(data.patient.patient_id).toBeTruthy();
  expect(data.patient.full_name).toBe('Mrs Auto Test');
  expect(data.appointment.patient_id).toBe(data.patient.id);

  // 5. Partner was registered too
  expect(data.partner.patient_id).toBeTruthy();
  expect(data.partner.full_name).toBe('Mr Partner Test');

  // 6. Receipt reference matches the appointment
  expect(data.receipt_ref).toBe(data.appointment.id);
});

test('TC-QR-003: Phone rate limit triggers after 5 bookings in 15 minutes', async ({ page, request }) => {
  const RATE_LIMIT_PHONE = '9840123456';
  const date = getTomorrow();

  // Start times seen in the availability response (no extra availability call needed)
  const POOL = [
    '08:00','08:15','08:30','08:45','09:00','09:15','09:30','09:45',
    '10:00','10:15','10:30','10:45','11:00','11:15',
    '12:30','12:45','13:00','13:15','13:30','13:45',
    '14:00','14:15','14:30','14:45','15:00','15:15','15:30','15:45',
    '16:00','16:15','16:30','16:45','17:00','17:15','17:30','17:45',
  ];
  const addMinutes = (t, mins) => {
    const [h, m] = t.split(':').map(Number);
    const total = h * 60 + m + mins;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };
  // pick 6 different random slots
  const starts = [...POOL].sort(() => Math.random() - 0.5).slice(0, 6);

  // 6 rapid booking calls, one after another, all with the same phone number
  const results = [];
  for (let i = 0; i < 6; i++) {
    const payload = {
      appointment: {
        branch: BRANCH,
        appointment_date: date,
        start_time: starts[i],
        end_time: addMinutes(starts[i], 15),
        type: 'consultation',
        reason: 'Initial consultation & assessment',
      },
      patient: {
        title: 'Mrs',
        first_name: 'Rate',
        last_name: 'Test',
        full_name: 'Mrs Rate Test',
        age: 20,
        date_of_birth: '2006-01-22',
        gender: 'female',
        phone: RATE_LIMIT_PHONE,
        purpose: 'Fertility Consultation',
        referral_source: 'Google',
        branch: BRANCH,
      },
      partner: {
        title: 'Mr',
        first_name: 'Rate',
        last_name: 'Partner',
        full_name: 'Mr Rate Partner',
        age: 20,
        date_of_birth: '2005-10-20',
        gender: 'female',
        phone: randomPhone('7'),
        purpose: 'Fertility Consultation',
        referral_source: 'Google',
        branch: BRANCH,
      },
      website: '',
    };

    const res = await request.post(BOOKING_ENDPOINT, { data: payload });
    results.push({
      call: i + 1,
      status: res.status(),
      retryAfter: res.headers()['retry-after'] || '-',
      body: await res.text(),
    });
  }

  // Show all 6 results on the page so the screenshot has evidence
  const esc = s => s.replace(/</g, '&lt;');
  await page.setContent(
    '<pre style="font-size:14px">' +
      results.map(r => `Call ${r.call}: ${r.status} (retry-after: ${r.retryAfter})\n${esc(r.body)}`).join('\n\n') +
    '</pre>'
  );
  console.log(results.map(r => `Call ${r.call}: ${r.status} (retry-after: ${r.retryAfter})`).join('\n'));

  // 1. The first 5 calls are not blocked by the rate limiter
  for (const r of results.slice(0, 5)) {
    expect(
      r.status,
      `Call ${r.call} was already rate-limited (retry-after: ${r.retryAfter}). Wait and rerun. ${r.body}`
    ).not.toBe(429);
  }

  // 2. The 6th call is blocked with 429 Too Many Requests
  expect(results[5].status, `Call 6: ${results[5].body}`).toBe(429);
});

test('TC-QR-004: Fertility consultation requires partner details', async ({ page, request }) => {
  const date = getTomorrow();

  // A random slot from the known slot list (no extra availability call)
  const SLOTS = [
    ['08:00', '08:15'], ['09:00', '09:15'], ['10:00', '10:15'], ['11:00', '11:15'],
    ['13:00', '13:15'], ['14:00', '14:15'], ['15:00', '15:15'], ['16:00', '16:15'],
    ['17:00', '17:15'], ['18:00', '18:15'],
  ];
  const [start, end] = SLOTS[Math.floor(Math.random() * SLOTS.length)];

  // Fertility Consultation with NO partner object
  const payload = {
    appointment: {
      branch: BRANCH,
      appointment_date: date,
      start_time: start,
      end_time: end,
      type: 'consultation',
      reason: 'Initial consultation & assessment',
    },
    patient: {
      title: 'Mrs',
      first_name: 'NoPartner',
      last_name: 'Test',
      full_name: 'Mrs NoPartner Test',
      age: 20,
      date_of_birth: '2006-01-22',
      gender: 'female',
      phone: randomPhone('9'),
      purpose: 'Fertility Consultation',
      referral_source: 'Google',
      branch: BRANCH,
    },
    website: '',
  };

  const response = await request.post(BOOKING_ENDPOINT, { data: payload });
  const bodyText = await response.text();

  // Show the response on the page so the screenshot has evidence
  await page.setContent(
    `<pre style="font-size:14px">Status: ${response.status()}\n${bodyText.replace(/</g, '&lt;')}</pre>`
  );
  console.log(`Status: ${response.status()}\n${bodyText}`);

  // Not blocked by the rate limiter (if it is, wait and rerun)
  expect(response.status(), `Rate limited, wait and rerun. ${bodyText}`).not.toBe(429);

  // 1. Booking without a partner must be rejected (not 201 Created)
  expect(response.status(), `Booking was accepted without a partner: ${bodyText}`).not.toBe(201);
  expect(response.status()).toBeGreaterThanOrEqual(400);
  expect(response.status()).toBeLessThan(500);

  // 2. The error message tells the user partner details are needed
  expect(bodyText.toLowerCase()).toContain('partner');
});

test.describe('TC-QR-005 mobile viewport', () => {
  // Mobile viewport (375px) with touch enabled, as in the test case
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

  test('TC-QR-005: DateWheelPicker touch-friendly selector selects a valid date (375px)', async ({ page }) => {
    test.setTimeout(90000);
    const note = description => test.info().annotations.push({ type: 'issue', description });

    await page.goto('/premier-plus-qr');

    // The patient's date picker is the first on the page (the partner's comes later)
    const badge = page.getByText(/^\d{2}-\d{2}-\d{4}$/).first();
    const wheel = name =>
      page
        .locator('div.flex-1.select-none', { has: page.getByText(name, { exact: true }) })
        .first()
        .locator('div.overflow-y-scroll');
    const items = name => wheel(name).locator('div.snap-center');

    const selectedIndex = name =>
      wheel(name).evaluate(el =>
        [...el.querySelectorAll('.snap-center')].findIndex(n => n.classList.contains('font-extrabold'))
      );
    const selectedText = async name => {
      try {
        return (await wheel(name).locator('div.snap-center.font-extrabold').first().innerText({ timeout: 1500 })).trim();
      } catch {
        return '';
      }
    };

    const readDate = async () => {
      const text = (await badge.innerText()).trim();
      const [d, m, y] = text.split('-').map(Number);
      return { d, m, y, text };
    };
    const isRealDate = ({ d, m, y }) => {
      const dt = new Date(y, m - 1, d);
      return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
    };
    const expectedAge = ({ d, m, y }) => {
      const now = new Date();
      let age = now.getFullYear() - y;
      if (now < new Date(now.getFullYear(), m - 1, d)) age--;
      return age;
    };

    // Wait until the date badge stops changing (the picker moves around right after load)
    async function waitUntilSettled() {
      const first = (await badge.innerText()).trim();
      let last = first;
      const start = Date.now();
      let stableSince = Date.now();
      while (Date.now() - stableSince < 1500 && Date.now() - start < 8000) {
        await page.waitForTimeout(150);
        const now = (await badge.innerText()).trim();
        if (now !== last) {
          last = now;
          stableSince = Date.now();
        }
      }
      return { first, settled: last };
    }

    // Real touch swipe (Chromium)
    const client = await page.context().newCDPSession(page);

    // Move one wheel by one value: tap -> swipe -> arrow button
    async function moveWheel(name) {
      await wheel(name).scrollIntoViewIfNeeded();
      const list = items(name);
      const count = await list.count();
      const idx = await selectedIndex(name);
      expect(idx, `${name} wheel: no selected value found`).toBeGreaterThanOrEqual(0);

      const dir = idx + 1 < count ? 1 : -1; // next value, or previous if already at the end
      const target = list.nth(idx + dir);
      const targetText = (await target.innerText()).trim();

      const reached = async () => {
        try {
          await expect.poll(() => selectedText(name), { timeout: 2500 }).toBe(targetText);
          return true;
        } catch {
          return false;
        }
      };

      // 1) touch tap on the neighbouring value
      await target.tap();
      if (await reached()) return { method: 'tap', targetText };

      // 2) real touch swipe of one row (rows are 36px tall)
      await wheel(name).scrollIntoViewIfNeeded();
      const box = await wheel(name).boundingBox();
      await client.send('Input.synthesizeScrollGesture', {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        yDistance: -dir * 36,
        gestureSourceType: 'touch',
        speed: 300,
      });
      if (await reached()) return { method: 'touch swipe', targetText };

      // 3) arrow button above or below the wheel
      await page.getByRole('button', { name: `${dir === 1 ? 'Next' : 'Previous'} ${name}` }).first().click();
      if (await reached()) return { method: 'arrow button', targetText };

      return null;
    }

    // 1. The date wheel picker is shown with Day, Month and Year wheels
    await expect(page.getByText('Date of Birth', { exact: true })).toBeVisible();
    for (const name of ['Day', 'Month', 'Year']) {
      await expect(wheel(name), `${name} wheel not found`).toHaveCount(1);
    }

    // 2. The page fits a 375px screen (no sideways scrolling)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'Page scrolls sideways at 375px').toBeLessThanOrEqual(1);

    // 3. The date should not change by itself after the page loads
    const { first, settled } = await waitUntilSettled();
    console.log(`Date right after load: ${first}   after it settled: ${settled}`);
    if (first !== settled) {
      note(`Selected date changed by itself after page load: ${first} -> ${settled}`);
    }

    // Size of the touch targets (printed for information)
    await wheel('Day').scrollIntoViewIfNeeded();
    const arrow = await page.getByRole('button', { name: 'Next Day' }).first().boundingBox();
    const row = await items('Day').first().boundingBox();
    console.log(`Arrow button: ${arrow.width}x${arrow.height}px, value row height: ${row.height}px`);
    if (arrow.width < 44 || arrow.height < 44) {
      note(`Arrow buttons are ${arrow.width}x${arrow.height}px, below the common 44px touch-target size`);
    }

    // 4. Change each wheel by touch and check the date stays valid
    let current = await readDate();
    expect(isRealDate(current), `Initial date is not valid: ${current.text}`).toBe(true);

    for (const { name, key } of [
      { name: 'Day', key: 'd' },
      { name: 'Month', key: 'm' },
      { name: 'Year', key: 'y' },
    ]) {
      const before = current;
      const result = await moveWheel(name);
      expect(
        result,
        `${name} wheel did not respond to tap, swipe or arrow button (date was ${before.text})`
      ).not.toBeNull();
      console.log(`${name} wheel moved by ${result.method}: ${before.text} -> value ${result.targetText}`);
      if (result.method !== 'tap') {
        note(`${name} wheel did not select the tapped neighbouring value (needed: ${result.method})`);
      }

      // The date badge must follow the wheel
      await expect(badge, `${name} wheel moved but the date badge did not update`).not.toHaveText(before.text, {
        timeout: 3000,
      });
      current = await readDate();

      expect(current[key], `${name} value did not change`).not.toBe(before[key]);
      if (key === 'd') expect(current.d).toBe(Number(result.targetText));
      if (key === 'y') expect(current.y).toBe(Number(result.targetText));
      if (key === 'm') expect(current.m).toBe((await selectedIndex('Month')) + 1);

      expect(isRealDate(current), `Not a real date: ${current.text}`).toBe(true);
      expect(
        new Date(current.y, current.m - 1, current.d) <= new Date(),
        `Date of birth is in the future: ${current.text}`
      ).toBe(true);
    }

    // 5. "Calculated Age" matches the selected date
    const age = page.getByText(/Years?\s*Old/i).first();
    await age.scrollIntoViewIfNeeded();
    await expect(age).toContainText(`${expectedAge(current)} Year`);
  });
});

test('TC-QR-006: Lunch break slots (11:30 - 12:30) are not selectable in the TimePicker', async ({ page }) => {
  test.setTimeout(90000);

  const LUNCH_START = 11 * 60 + 30; // 11:30
  const LUNCH_END = 12 * 60 + 30;   // 12:30

  // Turns "11:30 AM" into minutes since midnight
  const toMinutes = text => {
    const m = text.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = (text.match(/AM|PM/i) || [])[0];
    if (ap) {
      const pm = ap.toUpperCase() === 'PM';
      if (pm && h !== 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    return h * 60 + min;
  };

  // If something fails, print what is on screen so the real structure can be seen
  async function dumpPage() {
    const buttons = await page.getByRole('button').filter({ visible: true }).allInnerTexts();
    console.log('VISIBLE BUTTONS:\n' + buttons.map(t => t.replace(/\s+/g, ' ').trim()).join(' | '));
    const html = await page.getByText(/start time/i).first().evaluate(el => {
      let n = el;
      for (let i = 0; i < 3 && n.parentElement; i++) n = n.parentElement;
      return n.outerHTML;
    }).catch(() => 'Appointment step was not reached');
    console.log('START TIME HTML:\n' + html.slice(0, 6000));
    const errors = await page.locator('[role="alert"], [class*="red-"]').filter({ visible: true }).allInnerTexts();
    if (errors.length) console.log('VISIBLE ERRORS:\n' + errors.join('\n'));
  }

  try {
    // Step 1: registration (primary patient + partner, as for a Fertility Consultation)
    await page.goto('/premier-plus-qr');
    await page.getByPlaceholder('e.g. Rahul').fill('Slotcheck');
    await page.getByPlaceholder('e.g. Sharma').first().fill('Test');
    await page.getByPlaceholder('10-digit number').fill(randomPhone('9'));
    await page.getByPlaceholder('e.g. Priya').fill('Partnercheck');
    await page.getByPlaceholder('e.g. Sharma').nth(1).fill('Test');
    await page.getByPlaceholder('10-digit mobile number').fill(randomPhone('7'));
    await page.getByRole('button', { name: /Continue to Appointment/i }).click();

    // Step 2: appointment (nothing is submitted, so no records are created)
    await expect(
      page.getByText('Appointment Details').first(),
      'Did not reach the Appointment step (see VISIBLE ERRORS below)'
    ).toBeVisible({ timeout: 10000 });

    const dateUsed = await page.getByText(/^\d{2}-\d{2}-\d{4}$/).first().innerText().catch(() => 'unknown');
    console.log(`Appointment date used: ${dateUsed}`);

    // Read every option of the START TIME dropdown
    let options = [];
    const timeSelects = page.locator('select').filter({
      has: page.locator('option', { hasText: /\d{1,2}:\d{2}/ }),
    });

    if ((await timeSelects.count()) > 0) {
      // Normal <select> dropdown: the first one with times is START TIME
      const startSelect = timeSelects.first();
      await startSelect.scrollIntoViewIfNeeded();
      options = await startSelect.locator('option').evaluateAll(opts =>
        opts.map(o => ({ text: (o.textContent || '').trim(), disabled: o.disabled || o.hidden }))
      );
      // Show the whole list on screen so the screenshot proves what is available
      await startSelect.evaluate(el => { el.size = Math.min(el.options.length, 45); });
    } else {
      // Custom dropdown: click START TIME and read the options that appear
      const trigger = page
        .getByText(/start time/i)
        .first()
        .locator('xpath=following::*[self::button or @role="combobox"][1]');
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      const opts = page.getByRole('option');
      await expect(opts.first(), 'Start time dropdown options not found').toBeVisible({ timeout: 5000 });
      for (const el of await opts.all()) {
        const cls = (await el.getAttribute('class')) || '';
        options.push({
          text: (await el.innerText()).trim(),
          disabled:
            (await el.getAttribute('aria-disabled')) === 'true' ||
            /disabled|cursor-not-allowed|pointer-events-none/.test(cls),
        });
      }
    }

    const slots = options
      .map(o => ({ ...o, start: toMinutes(o.text) }))
      .filter(o => o.start !== null);
    expect(slots.length, 'No time options found in the Start Time dropdown').toBeGreaterThan(0);
    console.log('START TIME OPTIONS:\n' + slots.map(s => `${s.text}${s.disabled ? '  [disabled]' : ''}`).join('\n'));

    // Control check: slots just before and after the lunch break are selectable,
    // which proves the dropdown loaded correctly and is not simply empty
    const before = slots.find(s => s.start === LUNCH_START - 15 && !s.disabled);
    const after = slots.find(s => s.start === LUNCH_END && !s.disabled);
    expect(before, 'Control failed: the 11:15 AM option is missing or disabled').toBeTruthy();
    expect(after, 'Control failed: the 12:30 PM option is missing or disabled').toBeTruthy();

    // 1. Lunch break slots (11:30 - 12:30) are not selectable
    const lunch = slots.filter(s => s.start >= LUNCH_START && s.start < LUNCH_END);
    console.log(`Lunch break options in the dropdown: ${lunch.length ? lunch.map(s => s.text).join(', ') : 'none (hidden)'}`);
    const selectable = lunch.filter(s => !s.disabled).map(s => s.text);
    expect(selectable, 'These lunch break slots can be selected').toEqual([]);
  } catch (err) {
    await dumpPage();
    throw err;
  }
});

test('TC-QR-007: Step 3 displays SVG QR code with appointment booking reference', async ({ page }) => {
  test.setTimeout(120000);

  const toMinutes = text => {
    const m = text.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const ap = (text.match(/AM|PM/i) || [])[0];
    if (ap) {
      const pm = ap.toUpperCase() === 'PM';
      if (pm && h !== 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    return h * 60 + parseInt(m[2], 10);
  };

  // If something fails, print what is on screen so the real structure can be seen
  async function dumpPage() {
    const buttons = await page.getByRole('button').filter({ visible: true }).allInnerTexts();
    console.log('VISIBLE BUTTONS:\n' + buttons.map(t => t.replace(/\s+/g, ' ').trim()).join(' | '));
    const errors = await page.locator('[role="alert"], [class*="red-"]').filter({ visible: true }).allInnerTexts();
    if (errors.length) console.log('VISIBLE ERRORS:\n' + errors.join('\n'));
    const svgs = await page.locator('svg').evaluateAll(list =>
      list.map(s => {
        const b = s.getBoundingClientRect();
        return `${Math.round(b.width)}x${Math.round(b.height)} class="${s.getAttribute('class') || ''}" html=${s.innerHTML.length}`;
      })
    );
    console.log('SVGs ON PAGE:\n' + svgs.join('\n'));
    const text = (await page.locator('body').innerText()).slice(0, 3000);
    console.log('PAGE TEXT:\n' + text);
  }

  try {
    // Step 1: registration (primary patient + partner)
    await page.goto('/premier-plus-qr');
    await page.getByPlaceholder('e.g. Rahul').fill('Receipt');
    await page.getByPlaceholder('e.g. Sharma').first().fill('Test');
    await page.getByPlaceholder('10-digit number').fill(randomPhone('9'));
    await page.getByPlaceholder('e.g. Priya').fill('Receiptpartner');
    await page.getByPlaceholder('e.g. Sharma').nth(1).fill('Test');
    await page.getByPlaceholder('10-digit mobile number').fill(randomPhone('7'));
    await page.getByRole('button', { name: /Continue to Appointment/i }).click();

    // Step 2: appointment - pick a random start time (outside lunch) so slots do not clash between runs
    await expect(
      page.getByText('Appointment Details').first(),
      'Did not reach the Appointment step (see VISIBLE ERRORS below)'
    ).toBeVisible({ timeout: 10000 });

    const startSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: /\d{1,2}:\d{2}/ }) })
      .first();
    if (await startSelect.count()) {
      const opts = await startSelect.locator('option').evaluateAll(os =>
        os.filter(o => !o.disabled).map(o => ({ value: o.value, text: (o.textContent || '').trim() }))
      );
      const usable = opts.filter(o => {
        const mins = toMinutes(o.text);
        return mins !== null && !(mins >= 11 * 60 + 30 && mins < 12 * 60 + 30);
      });
      if (usable.length) {
        const pick = usable[Math.floor(Math.random() * usable.length)];
        await startSelect.selectOption(pick.value);
        console.log(`Start time chosen: ${pick.text}`);
      }
    }

    // Capture the booking response from the server (to compare with what Step 3 shows)
    const bookingResponse = page.waitForResponse(
      r => r.url().includes('/api/appointments/public/qr') && r.request().method() === 'POST' && r.status() === 201,
      { timeout: 30000 }
    );

    // Submit the request
    await page
      .getByRole('button', { name: /submit|send|request|confirm|book|schedule/i })
      .filter({ hasNotText: /back|retry/i })
      .last()
      .click();

    // Known bug (TC-QR-002): the first submit may fail. Retry once like a user would.
    const retry = page.getByRole('button', { name: /retry submission/i });
    const submitted = page.getByText('Request Submitted');
    await Promise.race([
      retry.waitFor({ timeout: 15000 }).catch(() => {}),
      submitted.waitFor({ timeout: 15000 }).catch(() => {}),
    ]);
    if (await retry.isVisible()) {
      test.info().annotations.push({
        type: 'bug',
        description: 'First submit failed with an error; booking only succeeded after Retry Submission (see TC-QR-002)',
      });
      await retry.click();
    }

    // 1. Step 3 is shown: the booking is completed
    await expect(submitted, 'Booking was not completed, Step 3 not shown').toBeVisible({ timeout: 20000 });
    const { data } = await (await bookingResponse).json();
    const ref = String(data.receipt_ref).toLowerCase();
    console.log(`Booking reference from server: ${data.receipt_ref}`);

    // 2. An SVG QR code is displayed (not a small icon)
    let qr = null;
    for (const svg of await page.locator('svg').filter({ visible: true }).all()) {
      const box = await svg.boundingBox();
      const cls = (await svg.getAttribute('class')) || '';
      const size = await svg.evaluate(el => el.innerHTML.length);
      if (box && box.width >= 80 && box.height >= 80 && !/lucide/.test(cls) && size > 500) {
        qr = { box, size };
        await svg.scrollIntoViewIfNeeded();
        break;
      }
    }
    if (!qr) {
      // Some pages show the QR as an <img> with an SVG data URL
      const img = page.locator('img[src^="data:image/svg"], img[src$=".svg"]').filter({ visible: true });
      if (await img.count()) {
        const box = await img.first().boundingBox();
        if (box && box.width >= 80 && box.height >= 80) qr = { box, size: 0 };
      }
    }
    expect(qr, 'No SVG QR code (80x80px or bigger) found on Step 3').not.toBeNull();
    console.log(`QR code found: ${Math.round(qr.box.width)}x${Math.round(qr.box.height)}px`);

    // 3. The appointment booking reference is displayed
    const pageText = (await page.locator('body').innerText()).toLowerCase();
    const shown = pageText.includes(ref) ? 'full reference' : pageText.includes(ref.slice(0, 8)) ? 'short reference' : null;
    expect(shown, `Booking reference ${data.receipt_ref} is not shown on Step 3`).not.toBeNull();
    console.log(`Booking reference shown on page: ${shown}`);
  } catch (err) {
    await dumpPage();
    throw err;
  }
});

test('TC-QR-008: /premier-plus-qr is publicly accessible without login', async ({ page }) => {
  // Unauthenticated user: a fresh Playwright session has no cookies and no saved login
  const cookiesBefore = await page.context().cookies();
  expect(cookiesBefore, 'Session is not clean, test must run as an unauthenticated user').toHaveLength(0);

  // 1. The URL responds successfully
  const response = await page.goto('/premier-plus-qr');
  expect(response.status()).toBe(200);

  // 2. The public page content is shown (wait for it first, because a redirect can happen after load)
  await expect(
    page.getByText('Patient Registration').first(),
    'Registration page not shown'
  ).toBeVisible({ timeout: 15000 });

  // 3. We were not redirected to the login page
  expect(page.url()).not.toContain('/auth');
  await expect(page).toHaveURL(/\/premier-plus-qr\/?$/);

  // 4. No login form is shown
  await expect(page.getByPlaceholder('you@hospital.com')).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^sign in$/i })).toHaveCount(0);

  // For information: what happens to a staff page for the same unauthenticated user
  await page.goto('/appointments');
  await page.waitForTimeout(2000);
  console.log(`Staff page /appointments without login ended at: ${page.url()}`);
});