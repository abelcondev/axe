---
name: new-app
description: Workflow for creating a new application from scratch. Covers
  discovery, the user's stack preferences with version research via context7,
  SDD + git setup with an architecture proposal, and project setup. Ends when
  the project foundations are delivered — feature development then continues
  through the native SDD loop.
when_to_use: When the user asks to create a new application, project, website, game, mobile app, CLI tool, or library from scratch.
---

# New Project Workflow

This workflow keeps the user in control at every step. **Never batch multiple
phases or sub-steps**. Always report what you did, then wait for the user to
say "continue" or give the next instruction before moving forward.

It covers project creation only — Phases 1 to 4. Once Phase 4 delivers the
project foundations, this skill is done: feature development continues through
the standing SDD loop from your system prompt (mini-discovery → proposal →
approval → tasks → implementation), not through this skill.

## Core Rule: One Step at a Time

After any step that writes files, runs commands, or installs dependencies:
1. Report what was done (one paragraph, no wall of text).
2. Ask explicitly whether to continue to the next step.
3. Do not proceed until the user confirms.

If the user says something like "sigue" or "continúa" without specifying what,
do the **next single sub-step** only — not everything remaining.

---

## Phase 1: Discovery

Ask the user the Discovery Checklist questions before proposing anything.
These questions change architecture — if the answer doesn't affect a decision,
it's not in the list.

Group questions conversationally (2–3 at a time). Adjust follow-ups based on
what the user already said. Do not rush or combine all questions into one block.

### Discovery Checklist

**Users & concurrency**
- Who uses the app? (roles: admin, operator, customer, staff, etc.)
- How many concurrent users? (1 person, small team, public)
- Single-tenant or multi-tenant (accounts)?

**Connectivity**
- Must it work offline or tolerate flaky internet?
- If offline: does data need to sync when back online?

**Device & interaction**
- Primary device? (desktop browser, tablet, mobile, kiosk)
- Hardware to integrate? (thermal printer, barcode scanner, cash drawer, NFC)

**Legal & compliance**
- Electronic invoicing or tax compliance? (SUNAT, SAT, AFIP, etc.)
- Data residency or privacy regulation? (GDPR, LGPD, etc.)

**Business logic**
- What is the one flow that absolutely cannot fail?
- External services to integrate? (payment processor, delivery API, SMS, etc.)
- Existing data to migrate from another system?

**Deployment & maintenance**
- Who hosts it and what is the infrastructure budget?
- Who maintains the codebase after delivery?
- Deadline or specific launch date?

When all questions are answered, summarize the answers back to the user to
confirm. Hold them in context — they are written to disk in Phase 3, step 3.

**Gate:** confirm the summary with the user before moving to Phase 2.

---

## Phase 2: The User's Stack First, Then Research

**Never propose a stack before asking.** The user usually arrives with a base
stack already in mind and deep expertise in specific technologies. Your job is
to build around their base, not to replace it.

### Step 1 — Ask for the user's stack

Ask conversationally (not as a form):
- Which base technologies do you plan to use? (frontend framework,
  backend/BaaS, database)
- Any other pieces already decided? (UI library, auth, hosting)
- Where do you have the most expertise, and is there anything you want to avoid?

### Step 2 — Research (mandatory — do not skip)

Take the user's base (e.g. frontend + database) and build everything else
around it: UI component library, icons, state management, forms, validation —
whatever the project needs. For every library — the user's picks AND the
complements you propose — run these steps in order:

```
For each library:
  1. resolve-library-id (context7 MCP) — find the library's context7 ID
  2. get-library-docs   (context7 MCP) — current version, breaking changes, known issues
  3. Cross-check peer dependencies between all candidates
  4. Fallback: WebFetch to npm registry only if context7 has no entry
```

Research output must include for each library:
- Latest stable version (pinned, not "latest")
- Compatibility confirmed with the rest of the stack
- Any breaking changes or known issues relevant to the use case
- Whether it's production-ready for the requirements from Phase 1

If a user choice conflicts with a discovery requirement (e.g. offline-first vs
a server-only stack), flag the conflict and explain it — never silently
substitute the user's technology. The user decides.

When research is done, report a short summary of findings before Phase 3.

---

## Phase 3: SDD + Git + Architecture Proposal

Execute **one sub-step at a time**. After each: report and wait.

### Step 1 — git init

Check `git status`. If the directory is not a git repository, run `git init`.

### Step 2 — Scaffold the SDD knowledge base

Invoke the `sdd-setup` command through the Skill tool (skill="sdd-setup").
It creates `sdd/` (index.md, log.md, proposal.md, decisions/, tasks/) and
loads the knowledge index into the current session.

### Step 3 — Record discovery

Write the confirmed Phase 1 answers to `sdd/decisions/001-discovery.md`
(`type: Decision`), append a line to `sdd/log.md`, and update `sdd/index.md`.

### Step 4 — Write the architecture proposal

Write the proposal to `sdd/proposal.md` (`type: Proposal`,
`status: in review`) using the structure from `arch-template.md` (co-located
with this skill). It must be built around the user's stack from Phase 2, with
every version pinned from the research.

**Gate: direct the user to review `sdd/proposal.md` and stop. Do not
scaffold, do not install, do not write any other files until the user
explicitly approves the architecture.**

If the user changes the stack (e.g., "I want InstantDB instead"), return to
Phase 2 research for the new libraries, then update the proposal.

---

## Phase 4: Setup (After Approval)

Starts only when the user approves the architecture proposal. Execute **one
sub-step at a time**. After each: report and wait for confirmation.

### Step 1 — Archive the decision

Move the approved proposal to `sdd/decisions/002-architecture.md`
(`type: Decision`), append a line to `sdd/log.md`, update `sdd/index.md`, and
reset `sdd/proposal.md` to its stub — leaving it ready for the first feature's
proposal.

### Step 2 — Scaffold the app

Run the scaffold command with pinned versions from Phase 2. Do not use
`@latest`. The directory already contains `sdd/` and `.git`: if the scaffold
tool refuses a non-empty directory, scaffold into a temporary subdirectory and
move the results into the project root.

After scaffolding: show the generated folder structure. Wait for confirmation.

### Step 3 — Dependencies

Pin all versions in `package.json`. Run the package manager install.
Verify there are no peer dependency warnings before reporting.

After install: show which packages were added and any warnings. Wait for
confirmation.

### Step 4 — Environment variables & gitignore

Create `.env.example` with every required key documented. Ensure `.gitignore`
covers `.env` (plus OS/editor noise). Never commit `.env`.

After creating: show the file contents. Wait for confirmation.

### Step 5 — Repository

Ask the user: create a new GitHub repo, or is there an existing remote?
- **New repo**: present the exact command for the USER to run — do not run it
  yourself:
  ```bash
  gh repo create <project-name> --private --source=. --remote=origin --push
  ```
- **Existing remote**: help configure it (`git remote add origin ...`).

Offer a minimal CI workflow (lint + typecheck on push/PR) in one line — create
it only if the user says yes.

### Step 6 — First commit

Stage the project and propose the first commit message (e.g.
`chore: initial project setup`). Run the commit once the user confirms.

### Step 7 — Handoff (end of skill)

The workflow ends here. Tell the user the project foundations are delivered
and that from now on features follow the standing SDD loop: they describe a
feature, you run a mini-discovery, write `sdd/proposal.md` for review, and on
approval continue per the SDD workflow in your system prompt. Do not start
proposing features yourself.

---

## What to do if the user says "sigue" or "continúa" mid-workflow

Do the **next single step only** — not all remaining steps. Report what you did
and wait again. The user's intent is to move one step forward, not to hand over
full control.

---

## Returning to a phase

- Requirement changes the architecture → back to Phase 3, step 4; new approval
  gate.
- Dependency conflict found in Phase 4 → back to Phase 2, resolve, then
  continue.
- Do not loop more than twice between phases without asking the user
  explicitly.
