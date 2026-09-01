# Changelog

Notable changes to the Power Pages Wildcard & Anonymous Access Auditor are recorded here. GitHub release packages and release-specific notes are available on the [Releases page](https://github.com/larsendn/power-pages-webapi-access-auditor/releases).

## [1.6.0.21](https://github.com/larsendn/power-pages-webapi-access-auditor/releases/tag/v1.6.0.21) - 2026-09-01

### Added

- An opt-in **Scan form web resources** source for selected-site scans.
- Scoped discovery of embedded HTML and JavaScript web resources from Dataverse forms used by Power Pages basic forms and multistep form steps.
- Recursive scanning of direct web-resource references from embedded HTML, with physical Web Resource record navigation in finding evidence.

### Changed

- Form-resource retrieval gaps become conservative review blockers without failing the rest of the site scan.
- Model-driven form event libraries are excluded unless they are also embedded in a portal-rendered form control.

## [1.6.0.20](https://github.com/larsendn/power-pages-webapi-access-auditor/releases/tag/v1.6.0.20) - 2026-09-01

### Added

- A dedicated **All attributes** review tab that reports every FetchXML `<all-attributes />` occurrence, even when the matching `Webapi/<table>/fields` setting has already been changed to an explicit list.
- Matched site-setting status, source-record navigation, and copyable explicit FetchXML attribute suggestions for all-attributes findings.
- A required manual field-review workflow for no-`$select` requests that return an opaque response object to callers.

### Changed

- Successfully undone wildcard settings move from **Updated wildcards** back to **Wildcard fields**, retain their evidence, and become the selected review item.
- Unresolved no-`$select` requests can no longer fall back automatically to a primary-key-only allowlist.

## [1.6.0.19](https://github.com/larsendn/power-pages-webapi-access-auditor/releases/tag/v1.6.0.19)

- Replaced internal model labels with accurate **SDM** and **EDM** terminology.
- Deduplicated sites discovered through both EDM virtual tables and Enhanced component storage.
- Preferred the EDM virtual-table representation for duplicate site IDs.
- Invalidated saved reviews created before the representation fix.

## [1.6.0.18](https://github.com/larsendn/power-pages-webapi-access-auditor/releases/tag/v1.6.0.18)

- Prevented code and wildcard evidence links from opening generic `powerpagecomponent` records.
- Resolved Enhanced evidence to physical Power Pages records and hid links when resolution was unavailable.
- Invalidated saved reviews containing obsolete component navigation.
- Added a FetchXML all-attributes test fixture and supporting documentation.

## [1.6.0.17](https://github.com/larsendn/power-pages-webapi-access-auditor/releases/tag/v1.6.0.17)

- Added the default-on Trial environment filter.
- Detected FetchXML `<all-attributes />` and blocked unsafe automatic remediation.
- Added copyable explicit-attribute suggestions while leaving customer code unchanged.
- Added direct physical-record navigation for Enhanced Power Pages evidence.

## [1.6.0.16](https://github.com/larsendn/power-pages-webapi-access-auditor/releases/tag/v1.6.0.16)

- Added independently collapsible Power Pages site groups in Review.
- Moved the apply-and-verify action into the review workflow.
- Excluded Teams and Trial environments from the original discovery defaults.
- Made PAC operations target the environment configured for the project.

## [1.6.0.15](https://github.com/larsendn/power-pages-webapi-access-auditor/releases/tag/v1.6.0.15)

- Rebuilt the distributable using the supported Power Apps Code Apps ALM workflow.
- Fixed fresh-environment launch behavior.
- Retained Enhanced wildcard detection and table-permission navigation fixes.
- Added installation and first-run guidance.

## [1.6.0.14](https://github.com/larsendn/power-pages-webapi-access-auditor/releases/tag/v1.6.0.14)

- Restored Enhanced-model wildcard detection.
- Improved anonymous-access record navigation.
- Added visible application-version metadata.

> The `v1.6.0.14` package was manually assembled and is superseded by `v1.6.0.15` and later supported packages.
