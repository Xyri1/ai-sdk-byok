# Decisions: Cloudflare Adapter

- **D-301 Always-encrypted, no plaintext mode.** Cloudflare has no managed per-user secret store or KMS; the platform-idiomatic pattern is ciphertext in D1/KV with a master key in a Worker secret and AES-GCM via `crypto.subtle`. A plaintext or pluggable mode would fragment the package's security story. (2026-07-17)
- **D-302 One package, two exports.** `@ai-sdk-byok/cloudflare` ships `d1Adapter` and `kvCredentialCache` together so Workers integrators get the complete composed setup on day one. (2026-07-17)
- **D-303 Bindings only.** The adapter consumes Workers bindings (`env.DB`, KV namespace), not the Cloudflare HTTP API. Structural typing; `@cloudflare/workers-types` is not a dependency. (2026-07-17)
- **D-304 Scope change to AGENTS.md.** "Non-Supabase storage adapters" leaves Out Of Scope; "Application-side cryptography" is narrowed to exclude this package's sealed-credential scheme. (2026-07-17)
- **D-305 Capacity ceiling documented, sharding deferred.** D1's 10 GB per-database cap supports roughly 8M stored keys; the schema is shard-friendly (all queries keyed by `user_id`, app-generated UUIDs) so a future sharded adapter needs no schema change. (2026-07-17)
- **D-306 Losing the master key is acceptable, not catastrophic.** Users re-enter API keys; provider keys are re-enterable by nature. Documented in the threat model. (2026-07-17)
- **D-307 KV eventual consistency documented, not solved.** A deleted/rotated cache entry may be readable in other regions until propagation (~60s) plus remaining TTL; entries remain ciphertext at rest. Guidance: keep `ttlMs` short. (2026-07-17)
