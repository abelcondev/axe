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

<!-- Simplified entity list with key relationships. Table or bullet list. -->

## Folder Structure

```
<project-name>/
  src/
  sdd/
  .env.example
```

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
