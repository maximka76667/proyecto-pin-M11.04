# AVD-PIN · Entrega 2: instructions for Claude Code
 
Read this whole file before changing anything. It says what the course asks for, what already exists in this repo, what to build, and in what order.
 
## 1. Context
 
- This repo is the PIN app (ROOM8, a flat-sharing app). `backend/` is NestJS + Prisma + Jest. `frontend/` is Expo / React Native.
- AVD-PIN is a separate course deliverable. The memoria is a Spanish PDF kept outside this repo. Its sections 2 and 3 cover validation.
- **Deadline:** Friday 27 November 2026. One upload per group.
- **Rubric items:** Automatización (describe the tool and give a worked example), Cobertura (real numbers, how they were computed, why these cases), Análisis de resultados (critical analysis and proposed actions).
## 2. Scope (decided)
 
The brief allows at most 2 functional and 2 non-functional requirements. We are using:
 
**Functional, both validated this week**
- **RF-01 Registro y reparto de gastos compartidos**
- **RF-02 Cálculo y simplificación del balance**
**Non-functional**
- **RNF-01 Seguridad y aislamiento por hogar:** validated this week.
- **RNF-02 Accesibilidad visual (WCAG 2.1):** described in the memoria and marked as **pending**, not validated. The redesign it depends on isn't finished. It will be validated for the final delivery in January.
  **Method for the final delivery (do not run now):**
  - **Automated accessibility tests:** axe-core through jest-axe. Render each listed critical screen and assert `toHaveNoViolations()`. Pass criterion: zero violations of impact `critical` or `serious`.
  - **Contrast check:** a Jest test that reads the colour pairs in `frontend/src/constants/theme.ts`, computes the WCAG contrast ratio, and asserts at least 4.5:1 for normal text and 3:1 for large text.
  - **Screen list:** to be agreed with the group once the redesign is done. Write it down before running the tests.
  - Optional cross-check on the Expo web build: Lighthouse accessibility audit. Report its score, but don't use it as the pass/fail criterion.
Do not add concurrency, performance, compatibility or any other requirement. Do not build Maestro, Applitools or Postman tooling for this delivery.
 
### Acceptance cases
 
Two to four cases per requirement. Each has a boundary or a case that could fail.
 
**RF-01 Registro y reparto de gastos**
- **PA-01 Límite superior:** an amount of 10000.00 is accepted; 10000.01 is rejected. The code's regex enforces this in `create-transaction.dto.ts` and `update-expense.dto.ts`. The memoria's 999.999.999 € is wrong and must be corrected.
- **PA-02 Importe no positivo:** an amount of 0 or a negative amount is rejected. Separate test from PA-03.
- **PA-03 Concepto vacío:** a blank concept is rejected (`expenses.controller.spec.ts` already has this case).
- **PA-04 Pagador obligatorio:** an expense sent without `from_user_id` is rejected with HTTP 400. The create DTO validates it as a UUID, but no test confirms the rejection yet, so add one (Task C).
- **PA-05 Reparto exacto:** 10,00 € split among three people sums to exactly 10,00 € (3,34 + 3,33 + 3,33), and leftover cents go to the first people by id (`expense-split.spec.ts`).
**RF-02 Cálculo y simplificación del balance**
- **PA-01 Pagos mínimos y cuadre al céntimo:** balances are exact to the cent, and applying the returned payments zeroes every balance. The algorithm is greedy, so the guarantee is **at most n−1 payments**. Do not claim it is the true minimum; that would be a stronger claim than the code supports.
- **PA-02 Estado vacío:** a household with no open debts returns no payments and no NaN, Infinity or 0 € transfers.
- **PA-03 Ciclo cerrado:** a closed debt cycle produces no payment (already in `transactions.service.spec.ts`).
**RNF-01 Seguridad y aislamiento por hogar**
- For the endpoints listed in Task B, 100% of requests from a user outside the household are blocked on the server with HTTP 403 or 404.
- Prefer **404** for another household's resources, so the response doesn't reveal that the resource exists. If the code returns 403, record that and justify it in the memoria.
- The response body contains no amounts and no other users' names.
- The endpoint list must be written down, so "100%" refers to a defined set.
## 3. What already exists (verified)
 
- `backend/src/transactions/expense-split.ts` and `expense-split.spec.ts` (11 tests): rounding and exact splits. Covers RF-01 PA-05.
- `backend/src/transactions/transactions.service.spec.ts`: balance tests for RF-02 PA-01 to PA-03.
- `backend/src/transactions/expenses.controller.spec.ts`: input-validation cases, including the 10000.00 maximum.
- `backend/src/transactions/balance-calculator.ts` (`calcularMinimosPagos`): used by `transactions.service.ts`, **not tested in isolation**.
- `backend/src/transactions/expenses.service.spec.ts`: has Forbidden checks, but no explicit cross-household HTTP test is confirmed.
- `frontend/src/lib/expense-split.ts` is a copy of the backend file. `expense-split.sync.spec.ts` fails if they differ. Keep them identical.
- CI (`.github/workflows/ci.yml`): backend `npm run build` then `npm test -- --ci`, and frontend `tsc`, lint and tests.
## 3b. Tool for each test to add
 
| Test to add | Requirement / case | Tool | Notes |
|---|---|---|---|
| Balance calculator property test (A1) | RF-02 PA-01 | **fast-check** (new dev dependency), run through **Jest** | Pure function, no database. |
| Expense split property test (A2) | RF-01 PA-05 | **fast-check**, run through **Jest** | Pure function, no database. |
| Empty-state and closed-cycle tests | RF-02 PA-02, PA-03 | **Jest** (already in use) | Already exist in `transactions.service.spec.ts`. Confirm they run on Node 24. |
| Amount boundary test (10000.00 accepted, 10000.01 rejected) | RF-01 PA-01 | **Jest + supertest** | The validation case exists in `expenses.controller.spec.ts`; add the accepted boundary if missing. |
| Blank concept and non-positive amount tests | RF-01 PA-02, PA-03 | **Jest + supertest** | Already in `expenses.controller.spec.ts`; confirm they run. |
| Missing payer test | RF-01 PA-04 | **Jest + supertest** | New. Send a create request without `from_user_id` and expect HTTP 400. |
| Accessibility tests (RNF-02, pending redesign) | RNF-02 | **jest-axe** (axe-core) and **Jest** for the contrast check | Do not write or run until the redesign is finished. Lighthouse is an optional cross-check only. |
| Cross-household read and write tests, one per endpoint (12 endpoints) | RNF-01 | **Jest + supertest** | Writes read the data back afterwards with **Prisma** (already the project's data layer), so the test proves nothing changed. Needs the real database, not mocks. |
| Coverage report | Cobertura rubric | **Jest** built-in coverage (`npm run test:cov`, Istanbul) | Run last, on Node 24. |
 
Nothing else needs a new tool. Maestro, Applitools and Postman are out of scope for this delivery.
 
## 4. What does not exist yet
 
- `fast-check` (not in `package.json`). Needed for RF-02 PA-01.
- A cross-household 403/404 test (RNF-01). Needed.
## 5. Environment constraints
 
- The project needs **Node 24**. The sandbox used for the earlier handoff had Node 22.
- Prisma engines can't be downloaded through the sandbox proxy, so `npm run build` and specs that import Nest/Prisma fail there with 403. This is an environment problem, not a code problem. Verify on Node 24 with network access, or in CI.
- Some specs use mocked or in-memory data. A mocked database can't prove anything about the database itself, so note it in the memoria whenever a test depends on mocks.
- Do not commit or push unless the user asks. Work on a branch if needed.
- Do not change production code to make a test pass without telling the user.
- If you can't do something the memoria describes, say so in your report. Do what's possible, and don't invent results.
## 6. Tasks, in order
 
### Task A: property tests with fast-check
 
Install once: `cd backend && npm i -D fast-check`. Both files below run in-process with no database, so they aren't affected by the mocking problem.
 
#### A1. Balance calculator (RF-02 PA-01)
File: `backend/src/transactions/balance-calculator.property.spec.ts`
 
- **Generator:** a list of 2 to 8 users. Draw integer cents for each user in [-100000, 100000], then set the last user's value to the negative of the sum of the others, so the list sums to zero exactly. Build `BalanceUsuario` entries with `userId: "u<i>"` and `balanceNeto: cents / 100`.
- **Run:** `fc.assert(fc.property(...), { numRuns: 500, seed: 42 })`.
- **Properties:**
  1. *Payments cancel the balances:* for each user, `balanceNeto*100 − (sum of outgoing monto*100) + (sum of incoming monto*100)` is within 1 cent of zero. The tolerance is 1 cent, not 0.01 euros, because each payment is rounded to 2 decimals.
  2. *Payment count:* `pagos.length ≤ n − 1`, where n is the number of users in the list. Say "at most n−1" in the memoria, not "minimum".
  3. *No dust payments:* every `monto > 0.01`.
  4. *Direction:* every `deudorId` has a negative balance, every `acreedorId` a positive one, and `deudorId !== acreedorId`.
- **Report:** numRuns, seed, number of runs that passed, and the counterexample if any fails.
#### A2. Expense split rounding (RF-01 PA-05)
File: `backend/src/transactions/expense-split.property.spec.ts`
 
- **Generators:**
  - `totalCents`: integer in [0, 1000000].
  - `participantIds`: a unique list of 1 to 10 ids drawn from a fixed pool such as `u0`…`u9`.
  - `payerId`: one of the participant ids, or an id outside the list, to cover both cases.
- **Run:** `fc.assert(fc.property(...), { numRuns: 1000, seed: 42 })`.
- **Properties:**
  1. *Exact total:* `sum(debts values) + payerCents === totalCents`.
  2. *Fair shares:* among the shares of everyone who participates (debts plus the payer's share if `payerParticipates`), `max − min ≤ 1` cent.
  3. *Integers and non-negative:* every share is an integer ≥ 0.
  4. *Payer outside the list:* `payerCents === 0` and `payerParticipates === false`. The total still sums correctly.
- **Empty list** (no participants) is covered by one unit test, not the property, because the property generator starts at one participant.
- **Report:** numRuns, seed, pass count, and any counterexample.
Commands: `cd backend && npm test -- balance-calculator.property expense-split.property --ci`.
 
Do not change the frontend copy of `expense-split.ts` in this task. If the backend file changes, run `expense-split.sync.spec.ts`.
 
### Task B: cross-household 403/404 test (RNF-01)
1. Copy the supertest setup from `transactions.controller.spec.ts` or `transactions.public-balance.spec.ts`.
2. Set up two households, A and B, with a member of A and existing data in B (at least one expense, one debt, one payment).
3. **One test per endpoint in the scope list below, for both reads and writes.** A read test checks the response; a write test checks the response and then reads B's data back to prove nothing changed. A 403/404 status alone is not enough, because the write could still have happened.
4. Expect HTTP 403 or 404 every time. Assert the body contains no amounts or user names.
5. Record the number of requests sent, blocked, and the status codes returned.
**Endpoint scope for RNF-01 (financial household data).** These are the endpoints in the repo that read or change a household's expenses, receipts, debts and payments:
 
- `GET /expenses` (list) — read
- `PATCH /expenses/:id` — write
- `DELETE /expenses/:id` — write
- `DELETE /receipts/:id` — write
- `POST /transactions` (manual create) — write, with `from_user_id` and debtors from household B
- `POST /transactions/from-receipt` — write
- `GET /transactions` — read
- `GET /transactions/:apartmentId/my-summary` — read
- `GET /transactions/:apartmentId/settle-up` — read
- `POST /transactions/:apartmentId/settle` — write
- `POST /transactions/:id/confirm` — write
- `POST /transactions/:id/reject` — write
Confirm the `transactions` route prefix in `app.module.ts` or the controller before writing the tests.
 
Out of scope for this delivery, and say so in the memoria: the public balance endpoint (`GET /transactions/public-balance/:inviteCode`), which is public by design and needs only the invite code; and household tasks, points, availability and notifications, which also hold household data but aren't part of the financial requirement. The intro mentions "datos de sus casas" more broadly, so the memoria should say the financial endpoints are the tested set and the rest is pending.
 
### Task C: check RF-01 cases against the code
1. Confirm the amount boundary (10000.00 accepted, 10000.01 rejected) with a test, not just the regex.
2. Add a test for PA-04: send a create request without `from_user_id` and expect HTTP 400. If the request is accepted, report it as a bug and do not change production code without telling the user.
3. Confirm the PA-04 error message. The memoria wording ("Debes seleccionar qué compañero ha realizado el pago") doesn't match the code's message. Align one of them.
4. Add tests only for behavior the code actually supports.
### Task D: coverage (last, after A to C)
1. On Node 24: `cd backend && npm ci && npm run build && npm run test:cov`
2. Record statements, branches, functions and lines for `balance-calculator.ts`, `expense-split.ts`, `expenses.service.ts` and `transactions.service.ts`.
3. Save the full summary to `docs/coverage-backend.txt`.
### Task E: report for the memoria
Report these, in this order:
1. Test counts for RF-01, RF-02 and RNF-01: passing, failing, and test names.
2. Property test: number of cases, any counterexamples.
3. RNF-01: the endpoint list, requests sent, requests blocked, status codes.
4. Coverage table from Task D.
5. Bugs found and what happened to them (fixed, or future work).
6. What wasn't done: RNF-02 (pending redesign), and anything that depends on mocks.
## 7. Known inconsistencies
 
- **Amount maximum:** memoria PA-03 says 999.999.999 €. Code and tests say 10000.00. Use 10000.00.
- **Receipt quantity limit:** `MAX_CANTIDAD = 999` in `create-receipt-transaction.dto.ts` is a per-item quantity limit on receipts, not the expense amount. Don't confuse the two.
- **PA-04 wording:** memoria and code messages differ. Align them.
- **Duplicate `expense-split` logic:** backend and frontend copies must stay identical. Run `expense-split.sync.spec.ts` after any change.
## 8. Output rules
 
- Test names and comments in Spanish, matching the existing specs.
- When the memoria describes a tool, include one real worked example from the repo (a code listing, not a screenshot).
- Never claim a result you did not measure.
 