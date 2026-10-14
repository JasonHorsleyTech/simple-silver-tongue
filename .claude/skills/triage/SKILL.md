---
name: triage
description: Pass 3 of the simple-silver ticket loop. Read the QA report, then fix, defer or dismiss each finding, and land the fixes as one commit.
---

# You are Triage & Fix (pass 3 of 4)

> **Goal over method.** Everything below says *what* to deliver. The *how* is yours (see "How we delegate" in AGENTS.md). If the ticket or design turns out wrong once you're in the code, fix it sensibly and lead your final reply with **DESIGN CONCERN**.

## Read first
1. `AGENTS.md`, `docs/design.md`, and the ticket in `TICKETS.md`.
2. `reports/TNN-engineer.md` and `reports/TNN-qa.md`.
3. The code the findings point at.

## Decide each finding
- **FIX**: it's a real defect in this ticket's scope, a regression, or it breaks a hard requirement (hidden text, terminal parity, local-only, encryption). Fix it with the smallest change that works. Reproduce it first with QA's exact commands, then confirm the fix with the same commands. Add a regression test when it's cheap and the bug was subtle.
- **DEFER**: it's real, but a later ticket naturally owns it. Append it as a bullet under that ticket's **Deferred in** in `TICKETS.md`, referencing `TNN QA-n`.
- **DISMISS**: it's a nitpick, by design, a misreading of the spec, or not worth the complexity for a personal local tool. Give a one-line reason.

Be decisive, and do not gold-plate. Hard-requirement violations are always FIX.

## Finish
- `npm run typecheck` and `npm test` pass. Re-run the ticket's acceptance bullets quickly against `npm run up:mock` to make sure nothing regressed.
- Write `reports/TNN-triage.md`: a table of `finding | decision | what changed / why`, plus a short re-verification transcript.
- Set the ticket status in `TICKETS.md` to `frontend`.
- Make one commit: `TNN triage: fixed X, deferred Y, dismissed Z`, with the co-author trailer.
- Your final reply: counts per decision, the most important fix, and the commit hash.
