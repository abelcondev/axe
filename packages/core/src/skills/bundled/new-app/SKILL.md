---
name: new-app
description: End-to-end workflow for creating a new application from scratch.
  Covers discovery, stack research via context7, architecture proposal, project
  setup, and SDD-driven feature development. Never skips phases or gates.
when_to_use: When the user asks to create a new application, project, website, game, mobile app, CLI tool, or library from scratch.
---

# New Project Workflow

This workflow keeps the user in control at every step. **Never batch multiple
phases or sub-steps**. Always report what you did, then wait for the user to
say "continue" or give the next instruction before moving forward.

## Core Rule: One Step at a Time

After any step that writes files, runs commands, or installs dependencies:
1. Report what was done (one paragraph, no wall of text).
2. Ask explicitly whether to continue to the next step.
3. Do not proceed until the user confirms.

If the user says something like "sigue" or "continúa" without specifying what,
do the **next single sub-step** only — not everything remaining.

---

## Artifact Paths

SDD artifacts live in `<project-dir>/sdd/`. Do not create them before the
project directory exists (Phase 4, step 2).

- `sdd/discovery.md` — answered discovery questions (`type: Decision`)
- `sdd/architecture.md` — approved architecture (`type: Decision`)
- `sdd/proposals/<feature>.md` — feature proposal awaiting approval (`type: Proposal`)
- `sdd/tasks/<feature>.md` — tasks for an approved feature (`type: Task`)

KnowledgeService picks up the entire `sdd/` tree in future sessions.

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
confirm. Hold them in context — do not write to disk yet.

**Gate:** confirm the summary with the user before moving to Phase 2.

---

## Phase 2: Research (mandatory — do not skip)

For every library or framework being considered, run these steps in order.
Do **not** propose a stack without completing this phase.

```
For each candidate library:
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

When research is done, report a short summary of findings before presenting
the architecture proposal.

---

## Phase 3: Architecture Proposal

Using the structure from `arch-template.md` (co-located with this skill),
present **two options** (with a recommended one) in the conversation. Each
option must cover:

- Stack with pinned versions (from Phase 2 research)
- Data model (simplified entity list)
- Folder structure
- Auth strategy
- Deployment target
- Why this option fits the discovery answers
- Tradeoffs vs. the other option

Hold the approved option in context. It will be written to `sdd/architecture.md`
in Phase 4, step 2.

**Gate: stop here and wait for explicit user approval before doing anything
else. Do not scaffold, do not install, do not write any files until the user
says the architecture is approved.**

If the user changes the stack (e.g., "I want InstantDB instead"), return to
Phase 2 and re-research the new libraries before updating the proposal.

---

## Phase 4: Setup

Execute **one sub-step at a time**. After each sub-step: report what was done
and wait for the user to say "continue" before moving to the next.

### Step 1 — Scaffold

Run the scaffold command with pinned versions from Phase 2. Do not use
`@latest`. Most scaffold tools auto-run `git init` — verify with `git status`
and do not run `git init` manually if the scaffold already did.

After scaffolding: show the generated folder structure. Wait for confirmation.

### Step 2 — SDD artifacts

```bash
mkdir sdd
```

Write these two files (content held in context from Phases 1 and 3):
- `sdd/discovery.md` with `type: Decision` frontmatter
- `sdd/architecture.md` with `type: Decision` frontmatter, using arch-template.md structure

After writing: confirm the files were created. Wait for confirmation.

### Step 3 — Dependencies

Pin all versions in `package.json`. Run the package manager install.
Verify there are no peer dependency warnings before reporting.

After install: show which packages were added and any warnings. Wait for confirmation.

### Step 4 — Environment variables

Create `.env.example` with every required key documented. Never commit `.env`.
Add `.env` to `.gitignore` if not already there.

After creating: show the file contents. Wait for confirmation.

### Step 5 — Minimal CI

Create `.github/workflows/ci.yml` with lint + typecheck on every push and PR.

After creating: show the workflow. Wait for confirmation.

### Step 6 — GitHub repo (user decision — do not run automatically)

Present the exact command and let the user decide:

```bash
gh repo create <project-name> --private --source=. --remote=origin --push
```

Explain: this creates the repo on GitHub, sets the remote, and pushes the
initial commit in one step. Tell the user to run it when ready, or skip if
the repo already exists.

**Do not run this command yourself.**

---

## Phase 5: Feature Development (SDD Loop)

After setup is complete, development follows a Proposal → Approval → Tasks →
Implementation cycle. Never start coding a feature without an approved Proposal.

### Step 5.1 — Write a Proposal

For each new feature (starting with the critical flow from Phase 1):

Create `sdd/proposals/<feature-name>.md` with this structure:

```markdown
---
type: Proposal
title: <Feature Name>
status: draft
---

## What
One paragraph: what this feature does and why it matters.

## Scope
Bullet list of exactly what is included and explicitly what is NOT included.

## Affected files
List the files that will be created or modified.

## Open questions
Any decisions that still need the user's input before implementation starts.
```

After writing the proposal: show it to the user. Wait for approval.
If there are open questions, answer them with the user before proceeding.

**Gate: do not write any implementation code until the user approves the Proposal.**

### Step 5.2 — Write Tasks

Once the Proposal is approved, create `sdd/tasks/<feature-name>.md`:

```markdown
---
type: Task
title: <Feature Name>
proposal: proposals/<feature-name>.md
status: in-progress
---

## Tasks

- [ ] Task 1 — description
- [ ] Task 2 — description
- [ ] Task 3 — description
```

Show the task list to the user. Ask if the breakdown looks right before starting.

### Step 5.3 — Implement one task at a time

Pick the first unchecked task. Implement only that task.
After each task: show what was changed, mark it done in the task file, and
ask the user whether to continue to the next task.

Do not implement multiple tasks in one response.

### Step 5.4 — Verify before closing

When all tasks are checked, run the type checker and linter.
If there are errors, fix them one at a time before reporting completion.

Update the proposal status to `approved` and task status to `done`.

### Step 5.5 — Next feature

Ask the user what to work on next. Go back to Step 5.1.

If the user changes a requirement that affects the architecture, create a new
`sdd/decisions/<topic>.md` recording the change before touching code.

---

## What to do if the user says "sigue" or "continúa" mid-workflow

Do the **next single step only** — not all remaining steps. Report what you did
and wait again. The user's intent is to move one step forward, not to hand over
full control.

---

## Returning to a phase

- Requirement changes the architecture → back to Phase 3, new approval gate.
- Dependency conflict found in Phase 4 → back to Phase 2, resolve, then continue.
- New feature → always start at Phase 5.1 (Proposal), never skip to code.
- Do not loop more than twice between phases without asking the user explicitly.
