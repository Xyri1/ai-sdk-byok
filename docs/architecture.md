# Architecture

`ai-sdk-byok` separates credential lifecycle policy from storage implementation.

## Core Entrypoint

The core manager owns:

- input validation;
- label normalization;
- key-hint derivation;
- metadata-only public write responses;
- proxy wrapping of returned plaintext credentials.

Adapters receive normalized inputs and return typed metadata or credentials.

## Supabase Entrypoint

The Supabase adapter uses a server-side Supabase client initialized with a secret key for credential-touching RPC calls and metadata listing. Supabase secret keys are the current replacement for legacy `service_role` API keys. Supabase Vault performs encryption and decryption inside the database boundary.

## Database Boundary

The migration creates `public.ai_sdk_byok_keys` for metadata and stores plaintext credentials only inside Vault secrets. Wrapper functions use `SECURITY DEFINER`, set `search_path = ''`, and grant execution only to `service_role`.

## Runtime Boundary

The package entrypoints avoid Node-only modules so they can run in Edge-compatible server runtimes. Tests may import Node test utilities, but package source must not.
