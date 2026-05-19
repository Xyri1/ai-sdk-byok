# Release Checklist Results

Results for the v0.1 package readiness checks.

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | TypeScript project typechecks with `tsc --noEmit`. |
| `npm run test` | Passed | Core manager and Supabase adapter unit tests pass. |
| `npm run build` | Passed | `tsup` emits ESM bundles and declaration files. |
| `npm pack --dry-run -w ai-sdk-byok` | Passed | Core package tarball contains `dist`, package README, package metadata, and license. |
| `npm pack --dry-run -w @ai-sdk-byok/supabase` | Passed | Supabase adapter tarball contains `dist`, package README, package metadata, license, and SQL migrations. |
| `npm publish --dry-run -w ai-sdk-byok` | Passed | Core package publish simulation succeeds with the `latest` tag. |
| `npm publish --dry-run -w @ai-sdk-byok/supabase --access public` | Passed | Scoped adapter package publish simulation succeeds with public access. |
| Edge bundle scan | Passed | Package entrypoints and built bundles do not import `node:*`, filesystem, TCP, CommonJS, or native dependencies. Test files may import Node utilities. |
| README examples | Passed | README imports match the exported `ai-sdk-byok` and `@ai-sdk-byok/supabase` APIs. |
| Supabase migration validation | Passed | Validated against real Supabase project `ksbttuqfmmffzkmtmdvb` inside a transaction followed by `ROLLBACK`; `public.ai_sdk_byok_keys` was confirmed absent afterward. |
