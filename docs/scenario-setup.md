# Scenario Setup

Use this documentation when adding a new CyberSim scenario that should run at its
own subdomain, such as `tnr.cybersim.app`.

This workflow spans both repositories:

- `CyberSim-UI` resolves the active scenario from the browser hostname and
  sends the slug to the backend.
- `CyberSim-Backend` maps that slug to Airtable content, imports or loads the
  scenario into PostgreSQL, and scopes games to that scenario.

## 1. Choose the scenario slug

Choose the slug before configuring anything else. The slug must match the
subdomain.

Examples:

| Hostname | Scenario slug |
|---|---|
| `cso.cybersim.app` | `cso` |
| `tnr.cybersim.app` | `tnr` |
| `campaign-2026.cybersim.app` | `campaign-2026` |

Use only lowercase letters, numbers, and hyphens. The backend validates slugs
with this rule.

## 2. Prepare the Airtable base

Create or duplicate the Airtable base for the new scenario.

Record the base ID from the Airtable URL:

```text
https://airtable.com/appXXXXXXXXXXXXXX/...
```

The `app...` value is the base ID. Do not use table IDs (`tbl...`) or view IDs
(`viw...`).

The base must contain the tables and fields the importer expects. For the exact
structure — every table, field, required/optional status, and single vs. multiple
links — see [`airtable-schema.md`](./airtable-schema.md).

For more detail on finding Airtable credentials, creating tokens, verifying
base access, and maintaining Airtable content, see `docs/airtable-handbook.md`.

## 3. Grant Airtable token access

CyberSim uses one backend Airtable Personal Access Token for all configured
scenario bases.

In Airtable, make sure the token has:

- `data.records:read`
- `schema.bases:read`
- Access to the new scenario base

The token is stored in the backend environment as:

```text
AIRTABLE_ACCESS_TOKEN=pat...
```

Do not commit Airtable tokens to either repository.

## 4. Update backend environment variables

In the backend environment, add the new scenario slug and Airtable base ID to
`AIRTABLE_BASE_IDS`.

Example:

```text
AIRTABLE_BASE_IDS=cso:appXXXXXX,tnr:appYYYYYY
```

Also add the new frontend origin to `UI_ORIGINS`.

Example:

```text
UI_ORIGINS=https://cso.cybersim.app,https://tnr.cybersim.app
```

Confirm the backend also has:

```text
IMPORT_PASSWORD=<chosen-password>
```

`IMPORT_PASSWORD` is required for imports from the admin UI or import endpoint.

After changing backend environment variables, restart or redeploy the backend so
the new values are loaded.

## 5. Configure the frontend subdomain

In AWS Amplify, add the new custom subdomain to the existing CyberSim UI app.

Example:

```text
tnr.cybersim.app
```

The UI determines the scenario slug from the hostname. For example,
`tnr.cybersim.app` resolves to `tnr`.

For real scenario subdomains, `REACT_APP_SCENARIO_SLUG` is not required. It is
only a fallback for localhost or bare-domain deployments.

The UI does need the backend API URL:

```text
REACT_APP_API_URL=https://<backend-api-host>
```

If DNS is managed outside Amplify, add the required DNS record for the new
subdomain according to Amplify's Domain Management instructions.

## 6. Import or load scenario content

There are two supported ways to get scenario content into PostgreSQL.

### Option A: Import from Airtable

Use this for current Airtable-authored content.

The first import for a brand-new scenario may need to be run directly against
the backend endpoint, because the UI import screen lists scenarios that already
exist in the database.

```bash
curl -X POST https://<backend-api-host>/admin/scenarios/import \
  -H 'Content-Type: application/json' \
  -d '{"scenarioSlug":"tnr","password":"<import-password>"}'
```

After the scenario exists in the database, it should appear in the admin
scenario screens.

### Option B: Load a saved scenario revision

Use this when scenario content has already been exported to the backend repo
under:

```text
seeds/scenarios/<slug>/<revision>/
```

The backend admin UI can load available revisions from disk, or you can call the
backend endpoint directly:

```bash
curl -X POST https://<backend-api-host>/admin/scenarios/load \
  -H 'Content-Type: application/json' \
  -H 'x-admin-password: <admin-password>' \
  -d '{"tag":"tnr@2026-03-19.1"}'
```

The tag format is:

```text
<scenario-slug>@<revision>
```

## 7. Verify the setup

Check that the backend returns the scenario:

```text
https://<backend-api-host>/scenario?scenarioSlug=tnr
```

Check static scenario data:

```text
https://<backend-api-host>/locations?scenarioSlug=tnr
https://<backend-api-host>/injections?scenarioSlug=tnr
```

Then open the new subdomain:

```text
https://tnr.cybersim.app
```

Create a test game and confirm the scenario name/content are correct.

## Troubleshooting

### Backend not reachable from the UI

Check:

- `REACT_APP_API_URL` in the Amplify UI environment
- backend health endpoint
- whether the backend is deployed and reachable over HTTPS

### CORS errors

Add the exact frontend origin to backend `UI_ORIGINS`.

Use no trailing slash:

```text
https://tnr.cybersim.app
```

### Scenario not found

The backend has not loaded that scenario into PostgreSQL yet, or the slug does
not match.

Check:

- subdomain slug
- `AIRTABLE_BASE_IDS`
- import/load result
- `GET /admin/scenarios`

### Airtable import fails

Check:

- `AIRTABLE_ACCESS_TOKEN` exists in the backend environment
- token has `data.records:read` and `schema.bases:read`
- token has access to the new base
- `AIRTABLE_BASE_IDS` includes `<slug>:<baseId>`
- `IMPORT_PASSWORD` matches the backend environment

### New scenario does not appear in the import dropdown

This can happen before the first import. Run the direct
`/admin/scenarios/import` request once with the new `scenarioSlug`.

## Related docs

- `README.md` in this repo: backend multi-scenario architecture
- `docs/airtable-handbook.md` in this repo: Airtable credentials and content rules
- `docs/aws-elasticbeanstalk-deployment.md` in this repo: backend environment variables and CORS configuration
- `CyberSim-UI/README.md`: UI multi-scenario behavior
- `CyberSim-UI/docs/aws-amplify-deployment.md`: Amplify custom domains
