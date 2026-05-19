# Decisions

This file mirrors the v0.1 decision log from `ai_sdk_byok_design.md` and records future changes that affect implementation.

## Accepted for v0.1

- Publish as one package with subpath exports.
- Ship Supabase Vault as the only storage backend.
- Keep provider strings opaque.
- Support only `{ apiKey: string }` credentials.
- Return metadata only from `save` and `list`.
- Return `null` from `get` when credentials are missing.
- Make public `delete` idempotent.
- Use hard deletes and trigger-owned Vault cleanup.
- Keep direct client access out of scope for v0.1.
- Use `SECURITY DEFINER` functions with `search_path = ''` for credential RPC.
- Preserve Edge-compatible package entrypoints.
