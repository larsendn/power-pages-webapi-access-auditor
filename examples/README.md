# FetchXML all-attributes test

Use `fetchxml-all-attributes-test.js` as the custom JavaScript for a temporary, authenticated Power Pages web page.

Test prerequisites:

1. Enable the `contact` table for the Power Pages Web API.
2. Set `Webapi/contact/fields` to `*`.
3. Grant the test user's web role read access to `contact`. Use the narrowest suitable table-permission scope.
4. Paste the sample into the temporary page's custom JavaScript and publish the site.
5. Run a new auditor scan. Do not restore an older saved review.

Expected auditor result:

- The `Webapi/contact/fields` wildcard is reported.
- Evidence includes `*` from `<all-attributes />`, `statecode` from the filter, and `fullname` from the order clause.
- Automatic approval is disabled and the finding says a code change is required.
- The suggested FetchXML replacement contains explicit `statecode` and `fullname` attributes.
- The suggestion warns that every field consumed by rendering or business logic must be added manually.
- **Open record** targets the physical web page record. If the physical record cannot be resolved, the button is hidden; it must never open a `powerpagecomponent` record.

The sample performs a read-only query limited to five active contacts. Remove the temporary page and any test-only Web API or table-permission configuration after verification.
