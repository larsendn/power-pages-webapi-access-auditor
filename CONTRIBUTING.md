# Contributing

## Development Workflow

1. Create a branch from `main`.
2. Keep changes focused and add regression tests for behavioral fixes.
3. Run `npm test`, `npm run lint`, and `npm run build`.
4. Open a pull request describing behavior, risk, validation, and any Power Platform deployment impact.

## Engineering Expectations

- Preserve the universal, schema-neutral solution architecture.
- Do not add static Dataverse `entityName` bindings to cloud flows.
- Prefer conservative detection: unresolved Web API behavior must block automatic confidence rather than silently disappear.
- Preserve customer-controlled review before applying changes.
- Do not commit generated solution ZIPs or environment-specific `power.config.json` files.
- Never include customer data, credentials, tokens, or connection exports.

## Release Changes

When changing flow contracts:

1. Regenerate solution flows.
2. Import the unmanaged candidate into the neutral test environment.
3. Refresh the affected Code Apps data-source schema.
4. Push and test the app.
5. Export and unpack the published app into the authoritative solution source.
6. Rebuild and certify managed and unmanaged packages.

## Licensing

Do not add third-party code or change licensing terms without confirming redistribution rights and project ownership.