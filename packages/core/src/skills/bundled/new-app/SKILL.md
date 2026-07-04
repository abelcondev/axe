---
name: new-app
description: End-to-end workflow for creating a new application from scratch.
  Covers discovery, stack research via context7, architecture proposal, GitHub
  setup, scaffolding, and dependency installation. Do not skip phases.
when_to_use: When the user asks to create a new application, project, website, game, mobile app, CLI tool, or library from scratch.
---

# New Project Workflow

Use this workflow when the user wants to build a new application, website, tool,
or service from scratch. Every phase produces an artifact. Do not combine phases
or skip them — the output of each feeds the next.

## Artifact Paths

Artifacts are written to the new project's `sdd/` directory **after the project
directory exists** (Phase 4.2). Do not write files to disk before that point —
hold discovery answers and the architecture proposal in context until then.

- `<project-dir>/sdd/discovery.md` — answered discovery questions
- `<project-dir>/sdd/architecture.md` — approved architecture proposal

The `sdd/` directory will be picked up by KnowledgeService in future sessions.

---

## Phase 1: Discovery

Ask the user all questions in the **Discovery Checklist** below before proposing
anything. These questions exist because their answers change the architecture —
if the answer doesn't affect a decision, it's not in the list.

Do not ask all questions at once. Group them conversationally by topic (2–3 at a
time). Adjust follow-ups based on answers already given.

### Discovery Checklist

**Users & concurrency**
- Who uses the app? (roles: admin, operator, customer, staff, etc.)
- How many users at the same time? (1 person, small team, public)
- Is there a concept of "accounts" or is it single-tenant?

**Connectivity**
- Does it need to work offline or with flaky internet?
- If offline: does data need to sync when back online?

**Device & interaction**
- What device is the primary target? (desktop browser, tablet touch, mobile, kiosk)
- Is there hardware to integrate? (thermal printer, barcode scanner, cash drawer, NFC)

**Legal & compliance**
- Is there electronic invoicing or tax compliance? (SUNAT, SAT, AFIP, etc.)
- Any data residency or privacy regulation? (GDPR, LGPD, etc.)

**Business logic**
- What is the one flow that absolutely cannot fail?
- Are there external services to integrate? (payment processor, delivery API, SMS, etc.)
- Is there existing data to migrate from another system?

**Deployment & maintenance**
- Who hosts it and what is the infrastructure budget?
- Who maintains the codebase after delivery? (client dev team, solo dev, agency)
- Is there a deadline or a specific launch date?

Once all questions are answered, hold the responses in context.
They will be written to `<project-dir>/sdd/discovery.md` in Phase 4.2.

---

## Phase 2: Research (mandatory — do not skip)

For every library or framework being considered, run the following steps in
order. Do **not** propose a stack without completing this phase.

```
For each candidate library:
  1. resolve-library-id (context7) — find the library's context7 ID
  2. get-library-docs   (context7) — get current version, breaking changes, known issues
  3. Cross-check peer dependencies between all candidates
  4. Fallback: WebFetch to npm registry only if context7 has no entry for the library
```

Research output must include for each library:
- Latest stable version (pinned, not "latest")
- Compatibility confirmed with the rest of the stack
- Any breaking changes or known issues relevant to the use case
- Whether it's production-ready for the requirements discovered in Phase 1

---

## Phase 3: Architecture Proposal

Using the structure from `arch-template.md` (co-located with this skill), present
**two options** (with a recommended one) directly in the conversation. Each
option must cover:

- Stack with pinned versions (from Phase 2 research)
- Data model (simplified entity list)
- Folder structure
- Auth strategy
- Deployment target
- Why this option fits the discovery answers
- Tradeoffs vs. the other option

Hold the approved option in context. It will be written to
`<project-dir>/sdd/architecture.md` in Phase 4.2.

**Gate:** wait for explicit user approval before continuing to Phase 4.
Do not scaffold anything until the user confirms the architecture.

---

## Phase 4: Setup

Execute in this exact order. Do not reorder steps.

### 4.1 Scaffold
Run the scaffold command for the chosen stack using pinned versions from Phase 2.
Do not use `@latest`. Most scaffold tools (`create-next-app`, `expo`, etc.) create
the project directory and run `git init` automatically — do not run `git init`
manually if the scaffold already did it. Verify with `git status` after.

```bash
# example — use the actual command from Phase 2
npx create-next-app@<pinned-version> <project-name> ...
cd <project-name>
git status   # confirm git is initialized
```

### 4.2 Create sdd/ and write artifacts
```bash
mkdir sdd
```

Write the following files now (content held in context since Phases 1 and 3):
- `sdd/discovery.md` — discovery answers with `type: Decision` frontmatter
- `sdd/architecture.md` — approved architecture using arch-template.md structure

### 4.3 Install dependencies
Pin all versions in `package.json`. Run the package manager install.
Verify no peer dependency warnings before continuing.

### 4.4 Minimal CI
Create `.github/workflows/ci.yml` with lint + typecheck on every push and PR.

### 4.5 Environment variables
Create `.env.example` with every required key documented. Never commit `.env`.
Add `.env` to `.gitignore` if not already there.

### 4.6 GitHub repo (optional — user decision)

Do not run this automatically. Present the command and let the user decide:

```bash
gh repo create <project-name> --private --source=. --remote=origin --push
```

Tell the user: this creates the repo on GitHub, sets the remote, and pushes the
initial commit in one step. Run it when ready, or skip if the repo already exists
or if you prefer to set it up manually.

---

## Phase 5: First Feature

Implement only the critical path identified in Phase 1 (the flow that cannot
fail). Verify it works before touching anything else.

---

## Iteration Rules

- If the user changes a requirement that affects the architecture, return to
  Phase 3 and get re-approval before touching code.
- If a dependency conflict is found during Phase 4, return to Phase 2 and
  resolve before scaffolding.
- Do not loop more than twice between phases without asking the user.
