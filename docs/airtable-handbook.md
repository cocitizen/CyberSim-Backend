# Airtable Handbook

## Overview

This handbook explains how CyberSim uses Airtable to manage scenario content, and how to connect, verify, and safely modify that content.

Airtable serves as the source of truth for scenario design, allowing non-developers to edit injections, responses, mitigations, and other game elements without changing code. The backend imports this content into PostgreSQL before each simulation run.

Because Airtable credentials and configuration are not immediately obvious in the UI, this guide also includes step-by-step instructions for:

* locating your Airtable Base ID
* creating a Personal Access Token (PAT)
* verifying that the backend can successfully connect to Airtable

If you are setting up a new scenario or debugging an import issue, start with the credential and verification sections before modifying content.

For the complete new-scenario workflow, including UI subdomain setup,
backend environment variables, Airtable configuration, import/load, and
verification, see:

    docs/scenario-setup.md

For the exact structure the importer expects — every table, field,
required/optional status, and single vs. multiple links — see:

    docs/airtable-schema.md

## Scenario Import

There are two ways to import current Airtable data into the database: a
command-line script for local development and a web endpoint for production or
the admin UI.

Both require these environment variables to be set:

- `AIRTABLE_ACCESS_TOKEN`
- `AIRTABLE_BASE_IDS`

### Command-line (local development)

```bash
SCENARIO_SLUG=cso npm run import:scenario
```

This calls Airtable directly — no running server required. The script reads
credentials from your `.env` file automatically.

After a successful import, snapshot the result to seed files so it can be
restored later without Airtable access:

```bash
SCENARIO_TAG=cso@2026-06-26.1 npm run save:scenario
```

See [Scenario Snapshots](#scenario-snapshots) for more on the snapshot workflow.

### Web endpoint (production / admin UI)

```bash
curl -X POST https://<backend-api-host>/admin/scenarios/import \
  -H 'Content-Type: application/json' \
  -d '{"scenarioSlug":"cso","password":"<import-password>"}'
```

This also requires `IMPORT_PASSWORD` to be set in the backend environment. The
admin UI calls this same endpoint — it prompts for the password and determines
the scenario slug from the subdomain (e.g. `cso.cybersim.app` imports `cso`).

## Finding Your Airtable Credentials

To connect Airtable to CyberSim, you need:

- `AIRTABLE_BASE_IDS` — Comma-separated `slug:baseId` pairs mapping each scenario to its Airtable base (e.g. `cso:appXXXXXX,tnr:appYYYYYY`)
- `AIRTABLE_ACCESS_TOKEN` — A Personal Access Token (PAT) with access to all configured bases
- `IMPORT_PASSWORD` — A password manually configured in the backend environment that authorizes imports via the UI

These are not prominently exposed in Airtable’s UI, so to capture them follow the steps below.

### Finding the Base ID

#### Option A: From the URL

1. Open your Airtable base
2. Look at the URL:

    https://airtable.com/appXXXXXXXXXXXXXX/...

The part starting with `app` is your Base ID.

Example entry in `AIRTABLE_BASE_IDS`:

    cso:appUBqXDEAK06rYeC

For multiple scenarios, add comma-separated pairs:

    AIRTABLE_BASE_IDS=cso:appUBqXDEAK06rYeC,tnr:appYYYYYYYYYYYYYY

#### Option B: From the API docs

1. Go to https://airtable.com/developers/web/api/introduction
2. Select your base
3. Look for URLs like:

    https://api.airtable.com/v0/appXXXXXXXXXXXXXX/TableName

The `appXXXXXXXXXXXXXX` portion is your Base ID.

#### Common confusion

- app... → Base ID (correct)
- tbl... → Table ID (wrong)
- viw... → View ID (wrong)

### Creating an Access Token (PAT)

CyberSim connects to Airtable using a Personal Access Token (PAT), which is a secure credential tied to your Airtable account. Unlike older API keys, PATs are scoped and limited, meaning you explicitly control what the token can access. This improves security and ensures that each scenario only has access to its own data.

#### Steps

1. Go to https://airtable.com/create/tokens
2. Click “Create new token”

#### Recommended configuration

**Name** - Give the token a descriptive name so you can recognize it later:

    CyberSim Backend

**Scopes** - define what actions the token is allowed to perform. Without the right scopes, the import process will fail.

For CyberSim, select both:

- `data.records:read` — allows the backend to read scenario content (required for import)
- `schema.bases:read` — allows reading table structure (required for the `/health/airtable` endpoint)

**Access** - define which Airtable bases the token can interact with. If you do not add a base here, imports for that scenario will fail.

- Choose “Specific bases”
- Click “Add a base” for **each scenario base** you want this token to cover

A single PAT can cover multiple bases, so you only need one token even if you run multiple scenarios.


#### Save the token

After creating the token, copy it and store it as:

    AIRTABLE_ACCESS_TOKEN=patXXXXXXXXXXXXXX

This token must be available to the CyberSim backend as an environment variable.
Environment variables are how the application securely receives secrets like API credentials without hardcoding them into the codebase.

* **Local development:** add it to your .env file in the backend project
* **Production (AWS Elastic Beanstalk):** add it under Configuration → Environment properties

⚠️ Do not commit tokens to GitHub or include them in shared files.

## Verifying Your Airtable Connection

Before running a full import, verify the connection.

### Backend health check

Start the backend and visit:

    http://localhost:3001/health/airtable

or:

    https://<your-api-host>/health/airtable

> **Note:** This endpoint checks connectivity using only the **first** base listed in `AIRTABLE_BASE_IDS`. A passing result confirms your token and that base are reachable, but does not verify every scenario base. Use the direct test below to check a specific base.

#### Expected success response

    {
      "ok": true,
      "baseId": "appXXXXXXXXXXXXXX",
      "tables": [...]
    }

#### Common errors

Missing variables:

    {
      "ok": false,
      "message": "Missing AIRTABLE_ACCESS_TOKEN or AIRTABLE_BASE_IDS"
    }

401 error:

- Invalid token

403 error:

- Token lacks access to this base (check the Access list on your PAT)

404 error:

- Incorrect Base ID

### Direct test for a specific base

To verify a particular scenario's base independently of the health endpoint:

    curl https://api.airtable.com/v0/meta/bases/<BASE_ID>/tables \
      -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>"

Replace `<BASE_ID>` with the `app...` value for the scenario you want to test (from `AIRTABLE_BASE_IDS`). A 200 response with a `tables` array confirms that base is accessible.

## Scenario Snapshots

After a successful Airtable import, snapshot the database into the repository
so it can be restored later without Airtable access.

### Full local workflow

```bash
# 1. Import from Airtable into local DB
SCENARIO_SLUG=cso npm run import:scenario

# 2. Save to seed files in the repo
SCENARIO_TAG=cso@2026-06-26.1 npm run save:scenario
```

The tag format is `<scenario>@<revision>`. Snapshots are stored under:

    seeds/datasets/<scenario>/<revision>/

Commit the saved files so other developers can restore from them without
needing Airtable credentials.

### Restoring a snapshot

To wipe and reload a scenario from a saved revision:

```bash
SCENARIO_TAG=cso@2026-06-26.1 npm run reset-db:scenario
```

This drops and recreates the schema, then seeds from the saved files. It
replaces only that scenario's content — other scenarios are untouched.

## Adding a New Scenario

For the full end-to-end workflow, including UI subdomain setup, backend environment variables, Airtable configuration, import/load, and verification, see:

    docs/scenario-setup.md

This handbook remains the reference for Airtable credentials and content rules.

## Airtable Content Rules

> For the complete field-level schema of every table (names, types,
> required/optional, and link directions), see
> [`airtable-schema.md`](./airtable-schema.md). The rules below cover the
> content conventions that field-level validation does not capture.

### Purchased Mitigations

Mitigations are grouped by category.

To adjust ordering:

1. Open the `purchase_mitigations` table.
2. Group by `category`.
3. Drag and reorder within each category.

The order in Airtable determines display order in the application.


### Locations

The application supports exactly two locations:

- `hq`
- `local`

⚠️ Do not modify the `location_code` values.  
Changing these will break application logic.

You may change display names without altering `location_code`.

### Dictionary

The dictionary table allows terminology customization (e.g., replacing "poll" or "budget").

To add or modify terminology:

- Edit the synonym column in the dictionary table.
