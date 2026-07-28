# Contributing to ARK

Thanks for helping explore reliability patterns for AI agent runtimes. ARK is a
reference implementation (see [Status & scope](./README.md#status--scope)), and a
TypeScript monorepo managed with **pnpm workspaces**.

## Prerequisites

- **Node.js ≥ 22** (24 LTS recommended — see `.nvmrc`). Tests run `.ts` files
  directly via Node's native type stripping, so Node ≥ 22.18 is required to run
  the test suite locally.
- **pnpm** (pinned via the `packageManager` field; `corepack enable` will fetch
  the right version automatically).

## Getting started

```bash
pnpm install
pnpm build        # tsdown → dist per package (topological order)
pnpm check        # typecheck + lint + schema:validate + test
```

Useful scripts (root):

| Script                | What it does                                      |
| --------------------- | ------------------------------------------------- |
| `pnpm build`          | Build every package and the MCP server example    |
| `pnpm typecheck`      | `tsc --noEmit` across the workspace               |
| `pnpm lint`           | Biome lint + format check                         |
| `pnpm lint:fix`       | Apply safe Biome fixes + format                   |
| `pnpm schema:validate`| Validate `schemas/examples/*` against the schema  |
| `pnpm test`           | Build, then run package and MCP integration tests |
| `pnpm changeset`      | Record a user-facing change (Changesets)          |

## Toolchain

- **Language:** TypeScript, ESM-only. Source must be *erasable* (no `enum`,
  namespaces, or parameter properties; use `import type` for type-only imports)
  — enforced by `erasableSyntaxOnly` so tests can run without a compile step.
- **Build:** [tsdown](https://tsdown.dev) (Rolldown). Public APIs need explicit
  return types (`isolatedDeclarations`).
- **Lint/format:** [Biome](https://biomejs.dev). Run `pnpm lint:fix` before
  pushing.
- **Tests:** the built-in `node:test` runner, zero extra dependencies.

## Module contract checklist

Every `@ark/*` package must satisfy the following before merge:

- [ ] Public types are defined in or re-exported from `@ark/core` (one shared
      vocabulary across `sanitize → classify → policy → report`).
- [ ] `package.json` follows the template: `type: module`, `exports` with
      `types` + `import` conditions, `files: ["dist", "README.md"]`,
      `sideEffects: false`, `build`/`test` scripts, `publishConfig.access:
      public`.
- [ ] Behavior is **deterministic** — no wall-clock reads or randomness in core
      logic (inject timestamps/ids instead) so outputs are snapshot-testable.
- [ ] Unit tests cover the happy path, edge cases, and a safe default/fallback.
- [ ] `README.md` documents the public API and the JSON output contract.
- [ ] `pnpm check` passes.
- [ ] A changeset is added for any user-facing change.

## Runtime-event schema

The runtime-event contract lives in `schemas/` and is validated in CI. See
[`schemas/README.md`](./schemas/README.md) for the **versioning rule**: additive
changes bump the minor and reuse the file; breaking changes publish a new
`runtime-event.v{N+1}.json` and freeze the old one. Keep `SCHEMA_VERSION` in
`@ark/core` in sync, and add example fixtures under `schemas/examples/`.

## Commits & PRs

- Conventional-commit style is appreciated (`feat(policy): …`, `fix(sanitize): …`).
- Fill in the PR template and check the boxes.
- CI must be green (quality job + test matrix on Node 22/24/26).

## Releasing

> ARK is a reference implementation and is **not currently published** to npm
> (see [Status & scope](./README.md#status--scope)). The release tooling below is
> configured but dormant; the notes are kept for anyone who forks ARK to publish
> their own line.

Releases use **Changesets** and publish to npm via **OIDC trusted publishing**
(no `NPM_TOKEN`). Merging the “Version Packages” PR publishes the bumped packages
with provenance attestations.

The Release workflow is currently **manually dispatched** (Actions → Release →
Run workflow). Before switching its trigger back to `push` (auto-release), two
prerequisites must be in place:

1. a trusted publisher configured on npmjs.com for each `@ark/*` package,
   pointing at `.github/workflows/release.yml`; and
2. **Settings → Actions → General → Workflow permissions →** “Allow GitHub
   Actions to create and approve pull requests” enabled (Changesets opens the
   “Version Packages” PR).
