# CyberSim Backend API

This repository contains the backend API for CyberSim, a tabletop simulation platform designed to help organizations practice responding to complex digital crises.

The backend manages game state, scenario data, database persistence, and Airtable imports.

For a high-level overview of CyberSim, see the CyberSim UI repository:
https://github.com/cdoten/CyberSim-UI

## Architecture

- Runtime: Node.js
- Framework: Express
- Database: PostgreSQL
- Query Builder: Knex
- Containerized via Docker
- Designed for AWS Elastic Beanstalk deployment

## Requirements

- Node.js (v22 recommended)
- Docker + Docker Compose (for local Postgres and container builds)
- PostgreSQL (production)

### Local Hosting Quick Start

docker compose -f docker-compose-dev.yaml up -d
cp .env.example .env
npm install
npm run reset-db
npm start

## Local Development

### 1. Clone the repository

```bash
git clone <REPO_LINK>
cd CyberSim-Backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create local environment file

```bash
cp .env.example .env
```

Adjust values in `.env` as needed.

### 4. Start local Postgres (Docker)

This project uses a custom Docker Compose file for development:

```bash
docker compose -f docker-compose-dev.yaml up -d
```

To stop containers:

```bash
docker compose -f docker-compose-dev.yaml down
```

### 5. Initialize database

Reset database (rollback → migrate → seed fixture data):

```bash
npm run reset-db
```

### 6. Start the API

```bash
npm start
```

API runs at:

```
http://localhost:3001
```

The port is controlled by the `PORT` environment variable.
Local development typically uses `3001`, while production uses `8080`.

## Project Structure

- `/src` — Application source code
- `/migrations` — Database schema migrations
- `/seeds` — Fixture data and dataset snapshots
- `/docker-compose-dev.yaml` — Local Postgres container for development 
- `/Dockerfile` — Production container definition

## Health Endpoints

- `GET /health` — Application status
- `GET /health/db` — Database connectivity check
- `GET /health/airtable` — Airtable configuration check

These endpoints are useful during deployment and infrastructure validation.

## Database & Seeding

The project supports two types of seed data.

### Fixture Seed (Default)

```bash
npm run reset-db
```

This will:

1. Roll back migrations
2. Apply latest migrations
3. Load deterministic fixture data

Used for local development and automated tests. This dataset does not depend on Airtable.

### Dataset Snapshots (Versioned Scenarios)

Scenario datasets exported from Airtable can be stored under:

```
seeds/datasets/<scenario>/<revision>/
```

Example:

```
seeds/datasets/cso/2026-03-03.1/
```

Load a dataset snapshot:

```bash
SCENARIO_TAG=cso@2026-03-03.1 npm run reset-db:scenario
```

This will:

1. Reset the database
2. Apply migrations
3. Load the selected dataset snapshot

### Export Scenario Revision from Database

After importing from Airtable, export a versioned snapshot of the current database content into the repository so it can be reloaded later without Airtable access:

```bash
SCENARIO_TAG=cso@2026-03-03.1 npm run save:scenario
```

The tag format is `<scenario>@<revision>`. This writes a scenario revision to:

```
seeds/datasets/<scenario>/<revision>/
```

### Individual Database Commands

Apply latest migrations:

```bash
npm run migrate
```

Roll back the most recent migration:

```bash
npm run rollback
```

Run seed scripts:

```bash
npm run seed
```

## Testing

Run automated tests:

```bash
npm run test
```

Tests use the `cybersim_test` database. Ensure your `.env` is configured to point to a test database before running tests.

The test suite resets and reseeds the database as part of execution.

## Environment Variables

### Required (Production)

- `PORT`
- `NODE_ENV`
- `DB_URL`
- `UI_ORIGINS`
- `AIRTABLE_ACCESS_TOKEN`
- `AIRTABLE_BASE_IDS`

#### DB_URL format

```
postgres://<USER>:<PASSWORD>@<HOST>:<PORT>/<DB_NAME>
```

#### NODE_ENV values

- `production`
- `development`
- `test`

#### UI_ORIGINS

Comma-separated list of frontend origins allowed to access the API via CORS. Do not include trailing slashes.

Local development:
```
UI_ORIGINS=http://localhost:3000
```

Production (one origin per scenario subdomain):
```
UI_ORIGINS=https://cso.cybersim.app,https://tnr.cybersim.app
```

#### AIRTABLE_ACCESS_TOKEN

A single Airtable Personal Access Token (PAT) with `data.records:read` and `schema.bases:read` scopes. One token can cover multiple bases.

#### AIRTABLE_BASE_IDS

Comma-separated list of `slug:baseId` pairs mapping each scenario slug to its Airtable base.

```
AIRTABLE_BASE_IDS=cso:appXXXXXX,tnr:appYYYYYY
```

The slug must match the subdomain used to access the UI (e.g. `cso` for `cso.cybersim.app`).

### Optional

- `IMPORT_PASSWORD` — Password required to trigger a scenario import via the UI. Import is disabled if not set.
- `SCENARIO_SLUG` — Backend fallback slug used when the frontend does not send one (see Multi-Scenario below).
- `LOG_LEVEL` — Defaults to `error` in production, `info` in development.

#### LOG_LEVEL options

- `fatal`
- `error`
- `warn`
- `info`
- `debug`
- `trace`

## Multi-Scenario Architecture

CyberSim supports multiple independent scenarios served from one backend and one Amplify frontend deployment. The scenario in use is determined by the subdomain.

### How slug detection works

**Frontend (UI):** On every page load, the UI reads `window.location.hostname` and uses the first subdomain segment as the scenario slug:

```
cso.cybersim.app  →  slug = "cso"
tnr.cybersim.app  →  slug = "tnr"
localhost         →  slug = REACT_APP_SCENARIO_SLUG env var, or "cso" if not set
```

The slug is sent to the backend as part of the CREATEGAME socket event and the `POST /scenario/import` request body.

**Backend:** Uses the slug it receives from the frontend to look up the correct Airtable base in `AIRTABLE_BASE_IDS` and to scope all game data to the correct scenario in the database.

`SCENARIO_SLUG` is a backend-only fallback used when the frontend does not send a slug — for example, during manual API calls, scripts, or in a single-scenario deployment where you want to hardcode the scenario server-side. The resolution order is:

```
slug from frontend request  →  SCENARIO_SLUG env var  →  "cso"
```

### Adding a new scenario

See `docs/airtable-handbook.md` for the full step-by-step process.

## Deployment

### Elastic Beanstalk:

See `docs/aws-elasticbeanstalk-deployment.md`.

## Airtable & Scenario Management

See `docs/airtable-handbook.md`.

## Credits

The CyberSim facilitation app was originally developed by Rising Stack for the National Democratic Institute (NDI), with support from Microsoft and the National Endowment for Democracy, as part of broader efforts to strengthen civic resilience in the digital age.