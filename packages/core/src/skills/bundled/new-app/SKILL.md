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

### Step 1 — git init (in the project directory, never above it)

The repository must belong to the project directory itself. **Never
initialize or reuse a repository at the user's home directory or any other
parent directory.**

1. Confirm you are working inside a dedicated project folder. If axe was
   started in the user's home or a general-purpose directory, stop: ask the
   user to create (or pick) a folder for this project — offer to create it
   for them — and do all remaining work inside that folder.
2. Run `git rev-parse --show-toplevel`:
   - It fails → run `git init` in the project directory.
   - It prints the project directory → a repo already exists; reuse it.
   - It prints a directory **above** the project (e.g. the home directory is
     itself a git repo) → do NOT reuse that repo: run
     `git init <project-dir>` so the project gets its own repository.

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

**Quality bar — the proposal must read like a senior engineer wrote it:**

- **Folder structure is modular by domain, not flat.** Group code by
  feature/domain (e.g. `features/orders/` with its own components, stores,
  types), keep routes/pages thin (they compose features), and share only
  true primitives (`components/ui/`, `utils/`). Annotate every folder with
  its purpose. Scale it to the project — a small CLI doesn't need domain
  modules, a multi-screen app does; say which shape applies and why.
- **Explicit module boundaries.** State the dependency direction (routes →
  features → shared) and the rules that keep it (features don't import each
  other directly; nothing imports from routes).
- **Data model with intent.** Entities, relationships, and the constraints
  that matter (uniqueness, ordering, timestamps, indexes for hot queries) —
  not just a table list.
- **The critical flow, engineered.** Walk the one flow that cannot fail
  step by step and state what happens when each step fails (offline,
  hardware down, double-submit, races between clients).
- **Every non-obvious choice justified** by a discovery answer or a research
  finding. No generic filler.

Before presenting, self-review: would a senior engineer sign this? If any
section is generic enough to fit any project, rewrite it for this one.

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
covers `.env` (and variants), `.axe/` (session-internal state — unless the
user wants to version project-level axe config), and OS/editor noise. Never
commit `.env`.

After creating: show the file contents. Wait for confirmation.

### Step 5 — First commit

The commit must exist BEFORE the repository step — `gh repo create --push`
fails on a repo with no commits.

Stage the project, review `git status` for anything that should not be
committed (fix `.gitignore` if something leaked), and propose the commit
message (e.g. `chore: initial project setup`). Ask the user whether they
want to run the commit themselves or have you do it — default to doing it
yourself once they confirm the message. Verify with `git log -1`.

### Step 6 — Repository

Ask the user: create a new GitHub repo, or is there an existing remote?
- **New repo**: present the exact command for the USER to run — do not run it
  yourself:
  ```bash
  gh repo create <project-name> --private --source=. --remote=origin --push
  ```
  The first commit from Step 5 already exists, so `--push` works.
- **Existing remote**: help configure it (`git remote add origin ...`) and
  push once the user confirms.

Offer a minimal CI workflow (lint + typecheck on push/PR) in one line —
create it only if the user says yes. If they accept, commit it and push.

### Step 7 — Handoff (end of skill)

The workflow ends here. Tell the user the project foundations are delivered
and that from now on features follow the standing SDD loop: they describe a
feature, you run a mini-discovery, write `sdd/proposal.md` for review, and on
approval continue per the SDD workflow in your system prompt. Do not start
proposing features yourself.

If the repo has a remote (and especially if CI was added), also suggest the
day-to-day git mode in two lines: substantial features on a feature branch +
PR (CI checks + preview deploy before merge), small fixes committed directly
to main. Offer to explain the workflow if the user is not familiar with it.

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
