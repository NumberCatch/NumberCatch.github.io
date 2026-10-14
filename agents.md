# Agent instructions

## Versioning

- Every pull request that changes application code or user-facing behavior must include a version bump in `package.json` and the root package entry in `package-lock.json`.
- Use semantic versioning: increment the patch version for backward-compatible fixes and small improvements, the minor version for backward-compatible features, and the major version for breaking changes.
- Keep the `version` values in `package.json`, `package-lock.json`, and `package-lock.json`'s `packages[""]` entry consistent.
- Mention the version bump in the pull request description.
- Do not merge a pull request until CI checks pass.
