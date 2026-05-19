# Package Workspaces Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the repo into one core npm package (`ai-sdk-byok`) and one scoped Supabase adapter package (`@ai-sdk-byok/supabase`).

**Architecture:** The repository root is private workspace tooling. `packages/core` publishes the root core API, and `packages/supabase` publishes the adapter package that depends on `ai-sdk-byok` and peers on `@supabase/supabase-js`.

**Tech Stack:** npm workspaces, TypeScript, tsup, Vitest.

---

### Task 1: Workspace Package Metadata

**Files:**
- Modify: `package.json`
- Create: `packages/core/package.json`
- Create: `packages/supabase/package.json`

**Steps:**
1. Make the root package private and add `workspaces: ["packages/*"]`.
2. Move publish metadata for `ai-sdk-byok` into `packages/core/package.json`.
3. Add `@ai-sdk-byok/supabase` package metadata in `packages/supabase/package.json`.
4. Keep shared tooling and scripts at the root.

### Task 2: Build Outputs

**Files:**
- Modify: `tsup.config.ts`

**Steps:**
1. Emit core to `packages/core/dist/index.js` and `.d.ts`.
2. Emit Supabase to `packages/supabase/dist/index.js` and `.d.ts`.
3. Mark `ai-sdk-byok` and `@supabase/supabase-js` as externals for adapter builds.

### Task 3: Imports, Docs, And Example

**Files:**
- Modify: `README.md`
- Modify: `docs/quickstart.md`
- Modify: `docs/release-checklist.md`
- Modify: `examples/nextjs-supabase/package.json`
- Modify: `examples/nextjs-supabase/lib/byok.ts`

**Steps:**
1. Replace `ai-sdk-byok/supabase` imports with `@ai-sdk-byok/supabase`.
2. Update install commands to include both packages.
3. Update the example local file dependency to point at the Supabase workspace package.

### Task 4: Verification

**Files:**
- Generated: `package-lock.json`
- Generated: `packages/*/dist`

**Steps:**
1. Run `npm install --package-lock-only` to refresh workspace lock metadata.
2. Run `npm run check`.
3. Run `npm pack --dry-run -w ai-sdk-byok`.
4. Run `npm pack --dry-run -w @ai-sdk-byok/supabase`.
5. Confirm both dry-run tarballs contain only intended files.
