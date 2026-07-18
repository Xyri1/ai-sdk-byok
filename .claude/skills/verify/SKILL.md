---
name: verify
description: How to verify supabase/migrations changes in this repo against a real database
---

# Verifying migrations

Docker Desktop (Windows/WSL2) must be running. If `docker` hits a
`docker-credential-desktop.exe: exec format error`, use a clean config:
`mkdir -p /tmp/dcfg && echo '{}' > /tmp/dcfg/config.json && DOCKER_CONFIG=/tmp/dcfg docker pull ...`

## Quick apply (psql, ordering + SQL validity)

```bash
docker run -d --name byok-verify -e POSTGRES_PASSWORD=postgres supabase/postgres:15.8.1.085
# WAIT for the image's own init to finish — pg_isready lies during the
# init phase (temporary server, vault not yet installed). Poll instead:
for i in $(seq 1 60); do
  docker exec byok-verify psql -U postgres -tAc \
    "SELECT 1 FROM pg_extension WHERE extname='supabase_vault'" 2>/dev/null | grep -q 1 && break
  sleep 2
done
docker cp supabase/migrations/. byok-verify:/migrations
docker exec byok-verify psql -U postgres -v ON_ERROR_STOP=1 \
  -f /migrations/001_ai_sdk_byok_init.sql \
  -f /migrations/002_ai_sdk_byok_save_returns_metadata.sql \
  -f /migrations/003_ai_sdk_byok_get_credentials_by_id.sql
```

The image bundles `supabase_vault`, required by these migrations. Note
`docker exec psql ... | tail` masks psql's exit code — check it directly.

## CLI surface (supabase db push)

`supabase db push` has NO `--file` flag (checked v2.109.1) and refuses
non-TLS `--db-url`. To test the tracked flow:

1. Run the container with `-p 55432:5432`.
2. Enable SSL inside it (the `postgres` role is not superuser — use
   `supabase_admin` over TCP with `-d postgres`, password = POSTGRES_PASSWORD):
   ```bash
   docker exec <c> bash -c 'openssl req -new -x509 -days 2 -nodes -out /var/lib/postgresql/server.crt -keyout /var/lib/postgresql/server.key -subj "/CN=localhost" && chown postgres:postgres /var/lib/postgresql/server.* && chmod 600 /var/lib/postgresql/server.key'
   docker exec -e PGPASSWORD=postgres <c> psql -U supabase_admin -h localhost -d postgres \
     -c "ALTER SYSTEM SET ssl = on;" \
     -c "ALTER SYSTEM SET ssl_cert_file = '/var/lib/postgresql/server.crt';" \
     -c "ALTER SYSTEM SET ssl_key_file = '/var/lib/postgresql/server.key';" \
     -c "SELECT pg_reload_conf();"
   ```
3. `npx -y supabase@latest db push --db-url "postgresql://postgres:postgres@127.0.0.1:55432/postgres" --yes`
4. History lands in `supabase_migrations.schema_migrations` (version = filename digit prefix).

## Functional smoke

Function signatures: `save_credentials(user_id, provider, credentials, label, key_hint)`,
`get_credentials(user_id, provider, label)`, `get_credentials_by_id(user_id, key_id)`,
`delete_credentials(user_id, key_id)`. After delete, `vault.secrets` should be
empty (cleanup trigger).
