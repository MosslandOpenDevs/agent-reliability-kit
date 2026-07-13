# ARK Schemas

JSON Schemas for the contracts ARK exchanges with the outside world. The
canonical **input** contract is the runtime event.

| File                      | Status  | Notes                                          |
| ------------------------- | ------- | ---------------------------------------------- |
| `runtime-event.v2.json`   | current | OpenTelemetry GenAI-aligned event model        |
| `runtime-event.v1.json`   | frozen  | original v1 draft, kept for back-compat        |

`examples/` holds fixtures that MUST validate against the current schema. CI runs
`pnpm schema:validate` (see `scripts/validate-schema.mjs`), which fails the build
on any violation — so the schema and its documented examples can never drift.

## Versioning rule

Schemas are versioned in the **filename** (`runtime-event.v{MAJOR}.json`) and the
`$id`, and mirror the `SCHEMA_VERSION` constant exported from `@ark/core`.

- **Additive, backward-compatible changes** (new optional field) → bump the
  package/`SCHEMA_VERSION` **minor**; keep the same schema file.
- **Breaking changes** (remove/rename a field, tighten a required set, change a
  type or enum) → publish a **new `runtime-event.v{N+1}.json`** and leave the
  previous file frozen. Update `CURRENT_SCHEMA` in `scripts/validate-schema.mjs`
  and add examples for the new version.
- The current schema uses `additionalProperties: false`, so unknown fields are
  rejected by the validation gate. Producers should therefore target a specific
  schema version rather than assuming forward-compatibility.

## OpenTelemetry GenAI alignment

Field names map to the OpenTelemetry GenAI semantic conventions (Development
stability as of mid-2026). See [`@ark/core`](../packages/core/README.md) and
`toGenAIAttributes()` for the field ⇄ attribute mapping. The deprecated
`gen_ai.system` attribute is intentionally not used; `provider` maps to the
current `gen_ai.provider.name`.
