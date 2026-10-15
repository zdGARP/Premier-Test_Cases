# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: QR.spec.js >> TC-QR-002: Public QR booking registers patient and books appointment in one transaction
- Location: tests\QR.spec.js:56:1

# Error details

```
Error: First submit: {"error":{"code":"CONFLICT","message":"Only fertility patients can be linked as partners"}}

expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 409
```

# Page snapshot

```yaml
- generic [active] [ref=e1]: "FIRST ATTEMPT (409): {\"error\":{\"code\":\"CONFLICT\",\"message\":\"Only fertility patients can be linked as partners\"}} FINAL RESULT (201): {\"data\":{\"appointment\":{\"id\":\"e4b43dd3-da0d-436e-b0a0-53d7351c34c9\",\"patient_id\":\"41e14012-384b-471d-a1aa-1628e94dfc7c\",\"doctor_id\":null,\"branch\":\"Kodambakkam\",\"appointment_date\":\"2026-10-15\",\"start_time\":\"19:15\",\"end_time\":\"19:30\",\"status\":\"pending\",\"type\":\"consultation\",\"reason\":\"Initial consultation & assessment\",\"notes\":\"Premier Plus QR request. Source IP: 172.18.0.4; User-Agent: Playwright/1.64.0 (x64; windows 10.0) node/24.14\",\"created_by\":null,\"created_at\":\"2026-10-14T09:01:54.914Z\",\"updated_at\":\"2026-10-14T09:01:54.914Z\"},\"patient\":{\"id\":\"41e14012-384b-471d-a1aa-1628e94dfc7c\",\"record_id\":\"ac303477-8618-4843-8002-113e2fe78be2\",\"patient_id\":\"KO00159\",\"title\":\"Mrs\",\"purpose\":\"Fertility Consultation\",\"first_name\":\"Auto\",\"last_name\":\"Test\",\"full_name\":\"Mrs Auto Test\",\"date_of_birth\":\"2006-01-22\",\"age\":20,\"gender\":\"female\",\"phone\":\"9561832674\",\"email\":null,\"blood_group\":null,\"area_of_residency\":null,\"referral_source\":\"Google\",\"aadhaar_number\":null,\"branch\":\"Kodambakkam\",\"branches\":[\"Kodambakkam\"],\"allergies\":[],\"address\":null,\"emergency_contact_name\":null,\"emergency_contact_phone\":null,\"medical_history\":null,\"created_by\":null,\"created_at\":\"2026-10-14T09:01:54.809Z\",\"updated_at\":\"2026-10-14T09:01:54.809Z\",\"linked_patient_id\":null,\"linked_patient\":null},\"partner\":{\"id\":\"0f8ea892-1d5f-4162-82aa-54f8adbc55a9\",\"record_id\":\"c592c867-0988-44de-937f-8565438dd0d7\",\"patient_id\":\"KO00160\",\"title\":\"Mr\",\"purpose\":\"Fertility Consultation\",\"first_name\":\"Partner\",\"last_name\":\"Test\",\"full_name\":\"Mr Partner Test\",\"date_of_birth\":\"2005-10-20\",\"age\":20,\"gender\":\"female\",\"phone\":\"7582700242\",\"email\":null,\"blood_group\":null,\"area_of_residency\":null,\"referral_source\":\"Google\",\"aadhaar_number\":null,\"branch\":\"Kodambakkam\",\"branches\":[\"Kodambakkam\"],\"allergies\":[],\"address\":null,\"emergency_contact_name\":null,\"emergency_contact_phone\":null,\"medical_history\":null,\"created_by\":null,\"created_at\":\"2026-10-14T09:01:54.815Z\",\"updated_at\":\"2026-10-14T09:01:54.815Z\",\"linked_patient_id\":null,\"linked_patient\":null},\"receipt_ref\":\"e4b43dd3-da0d-436e-b0a0-53d7351c34c9\"}}"
```

# Test source

```ts
  28  | 
  29  |   const { data } = await response.json();
  30  | 
  31  |   // 2. Response is for the requested branch and date, with 15-minute slots
  32  |   expect(data.branch).toBe(BRANCH);
  33  |   expect(data.date).toBe(date);
  34  |   expect(data.slot_minutes).toBe(15);
  35  | 
  36  |   // 3. Available slots are returned
  37  |   expect(Array.isArray(data.slots)).toBe(true);
  38  |   expect(data.slots.length).toBeGreaterThan(0);
  39  | 
  40  |   // 4. Every slot is exactly 15 minutes long and starts on a 15-minute mark
  41  |   for (const slot of data.slots) {
  42  |     const start = toMinutes(slot.start_time);
  43  |     const end = toMinutes(slot.end_time);
  44  |     expect(end - start).toBe(15);
  45  |     expect(start % 15).toBe(0);
  46  |   }
  47  | });
  48  | 
  49  | const BOOKING_ENDPOINT = '/api/appointments/public/qr';
  50  | 
  51  | // random 10-digit phone number so every run uses a new one
  52  | function randomPhone(prefix) {
  53  |   return prefix + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  54  | }
  55  | 
  56  | test('TC-QR-002: Public QR booking registers patient and books appointment in one transaction', async ({ page, request }) => {
  57  |   const date = getTomorrow();
  58  | 
  59  |   // Pick a free slot from the availability endpoint
  60  |   const availRes = await request.get(ENDPOINT, { params: { branch: BRANCH, date } });
  61  |   expect(availRes.status()).toBe(200);
  62  |   const { data: avail } = await availRes.json();
  63  |   expect(avail.slots.length).toBeGreaterThan(0);
  64  |   const slot = avail.slots[Math.floor(Math.random() * avail.slots.length)];
  65  | 
  66  |   const payload = {
  67  |     appointment: {
  68  |       branch: BRANCH,
  69  |       appointment_date: date,
  70  |       start_time: slot.start_time,
  71  |       end_time: slot.end_time,
  72  |       type: 'consultation',
  73  |       reason: 'Initial consultation & assessment',
  74  |     },
  75  |     patient: {
  76  |       title: 'Mrs',
  77  |       first_name: 'Auto',
  78  |       last_name: 'Test',
  79  |       full_name: 'Mrs Auto Test',
  80  |       age: 20,
  81  |       date_of_birth: '2006-01-22',
  82  |       gender: 'female',
  83  |       phone: randomPhone('9'),
  84  |       purpose: 'Fertility Consultation',
  85  |       referral_source: 'Google',
  86  |       branch: BRANCH,
  87  |     },
  88  |     partner: {
  89  |       title: 'Mr',
  90  |       first_name: 'Partner',
  91  |       last_name: 'Test',
  92  |       full_name: 'Mr Partner Test',
  93  |       age: 20,
  94  |       date_of_birth: '2005-10-20',
  95  |       gender: 'female', // same as the working browser request
  96  |       phone: randomPhone('7'),
  97  |       purpose: 'Fertility Consultation',
  98  |       referral_source: 'Google',
  99  |       branch: BRANCH,
  100 |     },
  101 |     website: '', // honeypot field, must stay empty
  102 |   };
  103 | 
  104 |   // 1. First submission (public, no login)
  105 |   let response = await request.post(BOOKING_ENDPOINT, { data: payload });
  106 |   let bodyText = await response.text();
  107 |   const firstStatus = response.status();
  108 |   const firstBody = bodyText;
  109 | 
  110 |   // 2. If it fails, record it as a bug and retry once (same as the "Retry Submission" button)
  111 |   if (firstStatus !== 201) {
  112 |     test.info().annotations.push({
  113 |       type: 'bug',
  114 |       description: `First submit returned ${firstStatus}: ${firstBody}`,
  115 |     });
  116 |     response = await request.post(BOOKING_ENDPOINT, { data: payload });
  117 |     bodyText = await response.text();
  118 |   }
  119 | 
  120 |   // Show both responses on the page so the screenshot has evidence
  121 |   const esc = s => s.replace(/</g, '&lt;');
  122 |   await page.setContent(
  123 |     `<pre style="font-size:14px">FIRST ATTEMPT (${firstStatus}):\n${esc(firstBody)}\n\nFINAL RESULT (${response.status()}):\n${esc(bodyText)}</pre>`
  124 |   );
  125 | 
  126 |   // The first attempt should succeed. This is a soft check: if it fails the test is
  127 |   // marked failed, but the checks below still run.
> 128 |   expect.soft(firstStatus, `First submit: ${firstBody}`).toBe(201);
      |                                                          ^ Error: First submit: {"error":{"code":"CONFLICT","message":"Only fertility patients can be linked as partners"}}
  129 | 
  130 |   expect(response.status(), bodyText).toBe(201);
  131 |   const { data } = JSON.parse(bodyText);
  132 | 
  133 |   // 3. Appointment was booked for the chosen branch, date and slot
  134 |   expect(data.appointment.branch).toBe(BRANCH);
  135 |   expect(data.appointment.appointment_date).toBe(date);
  136 |   expect(data.appointment.start_time).toBe(slot.start_time);
  137 |   expect(data.appointment.end_time).toBe(slot.end_time);
  138 |   expect(data.appointment.status).toBe('pending');
  139 |   expect(data.appointment.type).toBe('consultation');
  140 | 
  141 |   // 4. Patient was registered in the same transaction
  142 |   expect(data.patient.patient_id).toBeTruthy();
  143 |   expect(data.patient.full_name).toBe('Mrs Auto Test');
  144 |   expect(data.appointment.patient_id).toBe(data.patient.id);
  145 | 
  146 |   // 5. Partner was registered too
  147 |   expect(data.partner.patient_id).toBeTruthy();
  148 |   expect(data.partner.full_name).toBe('Mr Partner Test');
  149 | 
  150 |   // 6. Receipt reference matches the appointment
  151 |   expect(data.receipt_ref).toBe(data.appointment.id);
  152 | });
  153 | 
  154 | test('TC-QR-003: Phone rate limit triggers after 5 bookings in 15 minutes', async ({ page, request }) => {
  155 |   const RATE_LIMIT_PHONE = '9840123456';
  156 |   const date = getTomorrow();
  157 | 
  158 |   // Start times seen in the availability response (no extra availability call needed)
  159 |   const POOL = [
  160 |     '08:00','08:15','08:30','08:45','09:00','09:15','09:30','09:45',
  161 |     '10:00','10:15','10:30','10:45','11:00','11:15',
  162 |     '12:30','12:45','13:00','13:15','13:30','13:45',
  163 |     '14:00','14:15','14:30','14:45','15:00','15:15','15:30','15:45',
  164 |     '16:00','16:15','16:30','16:45','17:00','17:15','17:30','17:45',
  165 |   ];
  166 |   const addMinutes = (t, mins) => {
  167 |     const [h, m] = t.split(':').map(Number);
  168 |     const total = h * 60 + m + mins;
  169 |     return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  170 |   };
  171 |   // pick 6 different random slots
  172 |   const starts = [...POOL].sort(() => Math.random() - 0.5).slice(0, 6);
  173 | 
  174 |   // 6 rapid booking calls, one after another, all with the same phone number
  175 |   const results = [];
  176 |   for (let i = 0; i < 6; i++) {
  177 |     const payload = {
  178 |       appointment: {
  179 |         branch: BRANCH,
  180 |         appointment_date: date,
  181 |         start_time: starts[i],
  182 |         end_time: addMinutes(starts[i], 15),
  183 |         type: 'consultation',
  184 |         reason: 'Initial consultation & assessment',
  185 |       },
  186 |       patient: {
  187 |         title: 'Mrs',
  188 |         first_name: 'Rate',
  189 |         last_name: 'Test',
  190 |         full_name: 'Mrs Rate Test',
  191 |         age: 20,
  192 |         date_of_birth: '2006-01-22',
  193 |         gender: 'female',
  194 |         phone: RATE_LIMIT_PHONE,
  195 |         purpose: 'Fertility Consultation',
  196 |         referral_source: 'Google',
  197 |         branch: BRANCH,
  198 |       },
  199 |       partner: {
  200 |         title: 'Mr',
  201 |         first_name: 'Rate',
  202 |         last_name: 'Partner',
  203 |         full_name: 'Mr Rate Partner',
  204 |         age: 20,
  205 |         date_of_birth: '2005-10-20',
  206 |         gender: 'female',
  207 |         phone: randomPhone('7'),
  208 |         purpose: 'Fertility Consultation',
  209 |         referral_source: 'Google',
  210 |         branch: BRANCH,
  211 |       },
  212 |       website: '',
  213 |     };
  214 | 
  215 |     const res = await request.post(BOOKING_ENDPOINT, { data: payload });
  216 |     results.push({
  217 |       call: i + 1,
  218 |       status: res.status(),
  219 |       retryAfter: res.headers()['retry-after'] || '-',
  220 |       body: await res.text(),
  221 |     });
  222 |   }
  223 | 
  224 |   // Show all 6 results on the page so the screenshot has evidence
  225 |   const esc = s => s.replace(/</g, '&lt;');
  226 |   await page.setContent(
  227 |     '<pre style="font-size:14px">' +
  228 |       results.map(r => `Call ${r.call}: ${r.status} (retry-after: ${r.retryAfter})\n${esc(r.body)}`).join('\n\n') +
```