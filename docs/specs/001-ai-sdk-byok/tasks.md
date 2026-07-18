# Tasks: ai-sdk-byok v0.1

## Core Package

- [x] Scaffold root package metadata and exports.
- [x] Add public types for credentials and metadata.
- [x] Add error classes.
- [x] Add manager API skeleton.
- [x] Implement validation and label normalization.
- [x] Implement key-hint derivation.
- [x] Implement proxy-wrapped credential behavior.
- [x] Complete unit test coverage for validation and proxy behavior.

## Supabase Adapter

- [x] Scaffold `ai-sdk-byok/supabase` entrypoint.
- [x] Add secret-key Supabase adapter implementation.
- [x] Wrap Supabase failures as `AiSdkByokAdapterError`.
- [x] Complete mocked Supabase adapter tests.

## SQL Migration

- [x] Create initial Supabase Vault migration.
- [x] Validate migration against a real Supabase project.
- [x] Add integration-test setup notes.

## Example App

- [x] Scaffold `examples/nextjs-supabase`.
- [x] Add key management UI.
- [x] Add AI SDK route example.

## Documentation

- [x] Add quickstart.
- [x] Add architecture doc.
- [x] Add threat model.
- [x] Add release checklist results.

## Release Checklist

- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] Edge bundle scan confirms no Node-only imports in package entrypoints.
- [x] README examples match exported API.
