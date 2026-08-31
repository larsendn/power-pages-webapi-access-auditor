# Power Pages Wildcard & Anonymous Access Auditor

A Power Apps code app that scans Power Pages sites for:

- Wildcard `Webapi/<table>/fields` site settings.
- Anonymous table permissions.
- Static Web API field usage across pages, templates, forms, snippets, and code web files.

The app proposes explicit field allowlists, requires review before applying changes, verifies remote state, and records changes for guarded undo.

## Install the app

Download the latest managed solution from [GitHub Releases](https://github.com/larsendn/power-pages-webapi-access-auditor/releases) and follow the beginner-friendly [installation and first-run guide](INSTALLATION.md).

Current managed package: [PowerPagesWebApiFieldsAuditor_1_6_0_16_managed.zip](https://github.com/larsendn/power-pages-webapi-access-auditor/releases/download/v1.6.0.16/PowerPagesWebApiFieldsAuditor_1_6_0_16_managed.zip)

## Status

This is an independent, community-supported project created by a Microsoft employee. It is not an official Microsoft product, is not endorsed by Microsoft, and is not covered by Microsoft support or service-level agreements. Use it at your own risk and review every proposed remediation before applying changes.

## Architecture

The repository contains:

- A React, TypeScript, Vite, and Fluent UI code app.
- Seven solution-aware Power Automate cloud flows.
- A schema-neutral Dataverse integration supporting Standard (`adx_*`), Modern (`mspp_*`), and Enhanced Power Pages models.
- A hybrid code analyzer using tolerant JavaScript/TypeScript parsing, HTML script extraction, FetchXML analysis, and conservative fallback detection.

Cloud flows use selected-environment Dataverse operations with runtime-derived table names. Customers install one universal solution rather than model-specific packages.

## Security Model

- The Power Automate Management connection determines which environments are discoverable.
- The Microsoft Dataverse connection performs reads and approved writes.
- The connection identity must have appropriate access in every selected environment.
- Production environments are excluded until explicitly included.
- Scan results and review progress remain in browser-local storage unless exported by the user.
- Cloud type is not a runtime scan option; compatibility is validated as part of release testing.

Never commit customer scan output, connection exports, access tokens, credentials, or tenant-specific diagnostic logs.

## Local Development

Prerequisites:

- Node.js 20 or later.
- Microsoft Power Platform CLI.
- Power Apps Code Apps CLI authentication for Local Play or app push.

Install and validate:

```powershell
npm ci
npm test
npm run lint
npm run build
```

Copy `power.config.example.json` to `power.config.json`, then configure it through supported Code Apps CLI commands. `power.config.json` is ignored because it contains environment-specific identifiers.

Start Local Play:

```powershell
npm run dev -- --host 127.0.0.1 --port 5181
```

## Solution Build

The authoritative unpacked solution source is:

```text
solution/PowerPagesWebApiFieldsAuditor/src
```

Publish the code app into its Dataverse solution, then export official managed and unmanaged packages:

```powershell
$env:PPWFA_PRIVACY_FORBIDDEN_VALUES = "<environment-id>;<organization-url>;<organization-name>;<user-email>"
.\scripts\build-solution-packages.ps1 -Version 1.6.0.16 -SolutionId <solution-id>
```

The build runs tests, lint, and the production build; publishes with the supported `pa app push --solution-id` workflow; exports through Dataverse; and rejects archives containing configured source-environment values, organization URLs, email addresses, token signatures, or assigned secrets. Generated ZIP files are ignored; attach certified packages to a GitHub Release instead.

## Release Validation

Every release must pass `npm test`, `npm run lint`, and `npm run build`. Also verify:

- Managed and unmanaged flags are correct.
- Seven workflow definitions are packaged.
- No static `entityName` bindings are present.
- `MissingDependencies` is empty.
- Commercial, GCC, GCC High, and DoD compatibility is tested in their respective environments.
- Local Play workflows are tested with an authenticated connection identity.

## Limitations

Static code analysis cannot prove every dynamically constructed request. Unknown wrappers, dynamic table names, or unresolved field construction are surfaced as review blockers rather than treated as safe high-confidence allowlists.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and review expectations. Report security issues using [SECURITY.md](SECURITY.md).

## License

Licensed under the [MIT License](LICENSE). Microsoft, Power Apps, Power Automate, Power Pages, and Dataverse are trademarks of the Microsoft group of companies. Use of those names identifies the services this independent tool works with and does not imply endorsement.
