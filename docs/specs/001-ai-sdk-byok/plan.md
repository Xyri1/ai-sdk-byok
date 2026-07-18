# Implementation Plan

## Architecture

The v0.1 package is a single npm package with two public ESM entrypoints:

- `ai-sdk-byok`: core manager, public types, validation, and credential proxy behavior.
- `ai-sdk-byok/supabase`: Supabase Vault-backed storage adapter.

The manager owns validation, label normalization, key-hint derivation, and proxy wrapping. Storage adapters receive normalized, validated input.

## SDD Flow

1. Confirm behavior in `requirements.md`.
2. Break implementation into checklist items in `tasks.md`.
3. Implement the smallest vertical slice that satisfies one or more requirements.
4. Add or update tests before marking tasks complete.
5. Reflect new decisions in `decisions.md` when they change public behavior or operational guidance.

## Initial Milestones

- Milestone 1: Core manager, validation, and proxy unit tests.
- Milestone 2: Supabase adapter unit tests with mocked client.
- Milestone 3: SQL migration and integration-test harness.
- Milestone 4: Next.js Supabase example app.
- Milestone 5: Documentation pass and release readiness.
