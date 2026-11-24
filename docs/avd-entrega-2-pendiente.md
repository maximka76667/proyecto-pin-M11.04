# AVD-PIN · Entrega 2: what is left

Status on 2026-11-24. **Deadline: Friday 27 November 2026**, one upload per group. This file is the checklist of what remains. What was built and measured is in `docs/avd-entrega-2.md` (section 9 tests, section 10 findings, section 11 coverage). The text for the memoria sections 2 and 3 is drafted in Spanish in `docs/avd-entrega-2-memoria.md`.

## 1. Done

- [x] **Task A**: property tests with fast-check (balance calculator, expense split).
- [x] **Task B**: RNF-01 cross-household tests, 12 endpoints (plus 2 extra cases for `POST /transactions`).
- [x] **Task C**: RF-01 cases checked against the code, PA-04 test added.
- [x] **Task D**: coverage measured; full report saved in `docs/coverage-backend.txt`.
- [x] Four findings found by the tests, all fixed (section 10 of `docs/avd-entrega-2.md`).
- [x] Checks: backend build, lint and tests, and the frontend checks, all pass in CI (reported by the user on 2026-11-24).

## 2. Still to do

### 2.1 Data for the report (Task E)

Almost everything is measured. Gaps:

- [x] **RNF-01 request table**: measured on 2026-11-24 and already in `docs/avd-entrega-2-memoria.md`. 14 tests, all passing: 12 endpoint tests (10 answered 403, 2 answered 200 `[]`) plus 2 extra cases for `POST /transactions` (400).
- [ ] **Test counts per requirement** (passing / failing / names). The names are in section 9 of `docs/avd-entrega-2.md`; the totals per requirement have not been added up.
- [ ] **Property tests**: numRuns and seed are known (500 and 1000, seed 42). The line `[fast-check] …` printed after each suite gives the executed count if it is needed.

### 2.2 Corrections to make in the memoria (the PDF is outside the repo)

- [ ] Amount maximum: **10000.00 €**, not 999.999.999 €.
- [ ] PA-04 message: write the real one (`from_user_id must be a UUID`) or describe it as "400 with a message that names `from_user_id`". Decided: the memoria changes, the code stays.
- [ ] RF-02: say "**at most n−1 payments**", never "the minimum".
- [ ] RF-02: balances are exact to the cent **since the integer-cents fix** (before, a float residue could produce a 1-cent payment). A balance of exactly ±0.01 € is now settled; it used to be ignored.
- [ ] RNF-01: define "blocked" as in section 2 of `docs/avd-entrega-2.md` (403/404 for endpoints that address a household or resource; `200 []` for the two "mine" lists, counted separately).
- [ ] RNF-01: justify 403 over 404 for the endpoints by resource id (`PATCH`/`DELETE /expenses/:id`, `DELETE /receipts/:id`, `confirm`, `reject`): 403 reveals the id exists. Known limitation, 404 for outsiders is future work.
- [ ] RNF-01: say that the public balance endpoint (public by design) and tasks, points, availability, notifications and documents are **out of scope** and pending.
- [ ] RNF-01: say the isolation tests ran on the **in-memory Prisma**, not Postgres.
- [ ] RNF-02: describe it as **pending**, not validated, with the method (jest-axe, contrast check, screen list to agree, optional Lighthouse) and the January date.

### 2.3 Memoria text

- [ ] Review and adapt the drafts in `docs/avd-entrega-2-memoria.md` (Automatización, Cobertura, Análisis de resultados) to the memoria's format. They quote real code from the repo; update them if the code changes.
- [x] The RNF-01 status codes in that file are filled in (measured).

### 2.4 Upload

- [ ] Final read of the memoria for numbers that do not match the repo.
- [ ] One upload per group before Friday 27 November.

## 3. Not part of this delivery

- RNF-02 validation (pending the redesign; January).
- Maestro, Applitools, Postman, and any requirement beyond the four chosen.
- Tests of the remaining household endpoints. Their guards have **not been read**, so nothing is claimed about them: `apartments/:id/members`, `PATCH`/`DELETE /apartments/:id`, `users/:id`, availability, documents, tasks and points.

## 4. Open improvements (future work, not required)

- Return 404 instead of 403 to outsiders on the resource-by-id endpoints.
- Tests against a real Postgres for the isolation checks and for the Prisma error translation (`handlePrismaError`, uncovered).
- Test that `createFromReceipt` rejects a participant who is not a member (400), as was done for `POST /transactions`.
