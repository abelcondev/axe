---
type: Proposal
title: Architecture — <project-name>
description: Initial architecture proposal for <project-name>.
status: in review
timestamp: <ISO-8601 timestamp>
---

# Architecture: <project-name>

## Context

<!-- One paragraph: what is being built, for whom, and the key constraints
     from discovery (decisions/001-discovery.md) that drive the decisions
     below. -->

## Stack

<!-- Built around the user's chosen base. Every version pinned from Phase 2
     research — never "latest". "Chosen by" records whether the layer came
     from the user's preference or from research. -->

| Layer | Technology | Version | Chosen by |
|---|---|---|---|
| Frontend | | | user |
| Backend/BaaS | | | user |
| Database | | | user |
| UI components | | | research |
| Icons | | | research |
| Auth | | | |
| Hosting | | | |

## Data Model

<!-- Entities + relationships + the constraints that matter (uniqueness,
     ordering, soft-delete, timestamps, indexes for the hot queries). Not
     just a table list — a senior reader should see the shape of the data
     and why it holds. -->

## Folder Structure

<!-- Modular by domain, not flat-by-type. Routes/pages stay thin and compose
     feature modules; only true primitives are shared. Annotate every folder
     with its purpose. Scale it to the project: a CLI tool or landing page
     doesn't need feature modules — say which shape applies and why. -->

```
<project-name>/
  src/
    lib/
      db.ts                 # client init
      types.ts              # cross-feature types only — feature types live in the feature
      utils/                # generic helpers (currency, dates)
      components/ui/        # shared primitives (Button, Dialog, …)
      features/
        <domain>/           # one folder per business domain
          components/
          stores/
          types.ts
    routes/                 # thin — compose features, no business logic
  sdd/
  static/
  .env.example
```

### Module boundaries

<!-- Dependency direction and the rules that keep it, e.g.:
     routes → features → lib/{components/ui, utils, types}.
     Features never import each other directly — share via lib/types or
     events. Nothing imports from routes. -->

## Critical Flow & Failure Modes

<!-- Walk the one flow that cannot fail (from discovery) step by step. For
     each step: what happens when it fails — offline, hardware down,
     double-submit, race between terminals? State the recovery behavior. -->

## Auth Strategy

<!-- How authentication works. Who can log in, how sessions are managed. -->

## Deployment

<!-- Where it runs, how it gets deployed, estimated cost. -->

## Why this fits

<!-- 2–3 bullets connecting discovery answers + the user's stack preferences
     to this design. -->

## Alternatives considered

<!-- Only for layers where a real choice existed (user had no preference, or
     research surfaced a conflict): the alternative + why it was not chosen. -->

## Open questions

<!-- Decisions that still need the user's input before approval. -->
