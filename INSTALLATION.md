# Installation and First Run

This guide is for Power Platform administrators installing the packaged app. You do not need Node.js, source code, or developer tools.

> This is an independent, community-supported project. It is not an official Microsoft product and is not covered by Microsoft support.

## Prerequisites

- A Power Platform environment with Dataverse where you can import solutions.
- Permission to create or use Microsoft Dataverse and Power Automate Management connections.
- Read access to the Power Pages configuration in every environment you intend to scan.
- Write access in a target environment only if you intend to apply an approved field allowlist or use undo.

The identity used by the app's connections determines which environments and Power Pages records the app can access. Start with a non-production environment and use least-privilege access.

## 1. Download the managed solution

Download the latest managed ZIP from the project's GitHub Releases page:

- [PowerPagesWebApiFieldsAuditor_1_6_0_16_managed.zip](https://github.com/larsendn/power-pages-webapi-access-auditor/releases/download/v1.6.0.16/PowerPagesWebApiFieldsAuditor_1_6_0_16_managed.zip)
- [All releases](https://github.com/larsendn/power-pages-webapi-access-auditor/releases)

Do not extract the ZIP before importing it.

## 2. Import the solution

1. Open [Power Apps](https://make.powerapps.com/).
2. Select the environment where you want to install the auditor.
3. In the left navigation, select **Solutions**.
4. Select **Import solution** and browse to the managed ZIP.
5. Select **Next** and review the package details.
6. Select or create the requested connections when prompted:
   - **Microsoft Dataverse** reads configuration and performs explicitly approved changes.
   - **Power Automate Management** discovers environments available to the connection identity.
7. Complete the import and wait for it to report success.

The installed solution name is **Power Pages Web API Fields Auditor**. Version `1.6.0.16` contains one code app and seven cloud flows.

## 3. Verify connections and flows

1. Open the imported solution.
2. Check **Connection references** and resolve any connection marked invalid or missing.
3. Check **Cloud flows** and confirm all seven `PPWFA` flows are present and turned on.
4. If a flow is off, open it, confirm its connections, and turn it on.

The connection identity must also have access in each environment selected for scanning. Installing the solution in one environment does not automatically grant access to other environments.

## 4. Open and share the app

1. In the solution, open **Objects** and then **Apps**.
2. Locate **Power Pages Web API Access Auditor** and select **Play**.
3. To make the app available to another administrator, use **Share** and assign the appropriate app permission.
4. Ensure each user can use the required connections and has the necessary Dataverse permissions in scan targets.

The lower-left sidebar shows the running app version. Confirm it displays **Version 1.6.0.16**.

## 5. Run the first scan

1. Select the environments to scan.
2. Leave **Ignore inactive sites** enabled unless you intentionally need retired or inactive sites.
3. Leave **Audit anonymous table access** enabled to include table permissions assigned to Anonymous Users.
4. Start the scan and wait for all selected sites to complete.
5. Review wildcard and anonymous-access findings before making any change.

For wildcard findings, the app proposes an explicit field allowlist based on static code analysis. Dynamic requests may require manual review. Never approve a proposed allowlist until you have confirmed that it includes every field and relationship the site needs.

## Applying and undoing changes

- Applying a finding changes the remote `Webapi/<table>/fields` site setting only after explicit approval.
- The app verifies the remote value after applying it.
- Undo is guarded and restores the recorded previous value only when the current remote state has not changed unexpectedly.
- Power Pages configuration can be cached. Restart or refresh the site configuration when a correct change is not immediately reflected at runtime.

Test changes in a non-production site before applying them to production.

## Upgrade

1. Download the newer managed ZIP from [GitHub Releases](https://github.com/larsendn/power-pages-webapi-access-auditor/releases).
2. Import it into the same environment using **Solutions** > **Import solution**.
3. Choose the update option presented by Power Platform and retain the existing connection references.
4. After import, verify the flows are on and confirm the new version in the app sidebar.

## Uninstall

1. Export or record anything you need before removal.
2. In Power Apps, select the installation environment and open **Solutions**.
3. Select the managed **Power Pages Web API Fields Auditor** solution and choose **Delete**.

Uninstalling the auditor does not reverse changes it previously applied to Power Pages site settings. Use the app's guarded undo before uninstalling, or restore those settings through your normal Power Platform change process.

## Troubleshooting

### No environments appear

Verify the Power Automate Management connection and confirm its identity can discover the expected environments.

### A scan reports access or retrieval errors

Verify the Microsoft Dataverse connection identity has permission to read the target environment's Power Pages configuration tables. Standard, Modern, and Enhanced sites use different Dataverse representations.

### Apply fails

Confirm the Dataverse connection identity has write permission in the target environment and that the setting has not changed since review.

### The app shows an older version

Close the Power Apps player tab and open the app again from the solution. A browser hard refresh may also be required after an upgrade.

When reporting a problem, do not include access tokens, credentials, connection exports, customer scan output, or tenant-specific diagnostic logs in a public GitHub issue.