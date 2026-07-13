# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

When you make a user-facing change to any `@ark/*` package, add a changeset:

```bash
pnpm changeset
```

Pick the affected packages and a semver bump (patch / minor / major), and write a
short summary. The markdown file it creates is committed alongside your PR and is
consumed on release to bump versions and generate changelogs.

See `.changeset/config.json` for configuration.
