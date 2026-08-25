# Security Policy

## Reporting a Vulnerability

Do not open a public issue containing credentials, access tokens, customer environment details, scan results, or exploitable configuration data.

While this repository remains private, report security concerns directly to the repository owner through an approved internal channel. Include the affected version, reproduction steps using non-customer test data, potential impact, and suggested mitigation when known.

## Sensitive Data

The repository must not contain:

- Customer scan or debug logs.
- Power Platform connection exports.
- Access or refresh tokens.
- Client secrets, passwords, or certificates.
- Tenant-specific diagnostic API responses.
- Personally identifiable information from customer environments.

Revoke exposed credentials immediately and remove them from Git history before sharing the repository.

## Supported Versions

Only the latest private prerelease is actively maintained during validation.