# Security Policy

## Supported versions

ARK is pre-1.0. Security fixes are applied to the latest `main` and the most
recent published release of each `@ark/*` package.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

- Use GitHub's [private vulnerability reporting](https://github.com/MosslandOpenDevs/agent-reliability-kit/security/advisories/new) (Security → Report a vulnerability), or
- Email the maintainers with a description, reproduction steps, and impact.

We aim to acknowledge reports within 3 business days and to provide a remediation
timeline after triage. Coordinated disclosure is appreciated — please give us a
reasonable window to ship a fix before any public write-up.

## Scope

ARK processes untrusted runtime payloads (model requests/responses, error text).
Reports that are especially valuable:

- sanitizer bypasses that allow control characters, ANSI, or markup to survive into a provider payload
- classification or policy logic that can be steered by attacker-controlled error text
- ReDoS or resource-exhaustion in any `@ark/*` parser or transform
