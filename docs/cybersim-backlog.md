# CyberSim Backlog

This file tracks bugs, rough edges, deployment follow-ups, documentation updates, and feature ideas that are worth preserving but not necessarily scheduled.

Items here are not commitments. When something becomes planned work, promote it to a GitHub Issue.

## Needs triage

Items captured quickly, before we decide whether they are bugs, enhancements, docs updates, or future ideas.

### Example item title

**Type:** Bug / enhancement / docs / ops / admin UX / gameplay  
**Source:** Where this came from  
**Priority:** Low / medium / high  
**Effort:** Small / medium / large  
**Status:** Needs triage  

Notes:

- What happened?
- Why does it matter?
- Any links, commands, screenshots, or examples?

## Bugs and confusing behavior

Things that are broken, misleading, or likely to confuse users or maintainers.

### Replace misleading “Backend not reachable” message

**Type:** UX / bug  
**Source:** Rodrum scenario setup  
**Priority:** High  
**Effort:** Small / medium  
**Status:** Needs issue  

The UI displayed:

```text
Backend not reachable at https://api.cybersim.app
```

even though the backend, CORS, and Airtable access were working.

The real backend error was:

```json
{
  "error": "SCENARIO_NOT_FOUND",
  "message": "Scenario not found: \"rodrum\""
}
```

Better behavior:

- distinguish backend unavailable from scenario-loading errors;
- show a clearer message for unknown scenario slugs;
- suggest running scenario import when a scenario exists in Airtable but has not been imported into PostgreSQL.

## Setup and operations improvements

Improvements to deployment, scenario setup, health checks, imports, hosting, or maintenance workflows.

### Add scenario setup validation endpoint

**Type:** Ops / admin  
**Source:** Rodrum scenario setup  
**Priority:** Medium  
**Effort:** Medium  
**Status:** Backlog  

Create an endpoint that checks whether a scenario is fully ready.

Possible endpoint:

```http
GET /admin/scenarios/:scenarioSlug/status
```

Possible checks:

- `AIRTABLE_BASE_IDS` includes the scenario slug;
- Airtable base is reachable;
- required Airtable tables exist;
- scenario has been imported into PostgreSQL;
- scenario data routes return expected values;
- frontend origin is allowed by CORS.

## Admin UX improvements

Improvements to screens or workflows used by admins and facilitators.

### Improve first-time scenario import flow

**Type:** Admin UX  
**Source:** Rodrum scenario setup  
**Priority:** Medium  
**Effort:** Small / medium  
**Status:** Backlog  

The Scenario Import popup initially showed only existing scenarios. Rodrum appeared only after running a direct admin import.

Better behavior:

- allow entering a new `scenarioSlug` manually;
- or populate the import list from configured `AIRTABLE_BASE_IDS`;
- or show imported and not-yet-imported scenarios separately.

## Gameplay and product ideas

Ideas that improve the simulation experience for facilitators, participants, or observers.

### Example gameplay idea

**Type:** Gameplay  
**Source:** Demo / user feedback / internal testing  
**Priority:** Low / medium / high  
**Effort:** Small / medium / large  
**Status:** Backlog  

Notes:

- Who benefits?
- What problem does this solve?
- Is this necessary for a pilot, or just a nice improvement?

## Documentation updates

Docs that should be added or improved.

### Keep add-a-scenario checklist current

**Type:** Docs  
**Source:** Rodrum scenario setup  
**Priority:** High  
**Effort:** Small  
**Status:** Backlog  

The scenario setup process should document:

- creating or duplicating the Airtable base;
- granting the PAT access to the new base;
- adding the Amplify custom subdomain;
- adding the Cloudflare CNAME;
- updating `UI_ORIGINS`;
- updating `AIRTABLE_BASE_IDS`;
- validating CORS;
- validating Airtable access;
- running the direct admin import;
- confirming scenario data routes work;
- smoke testing the scenario URL.

## Done

Completed or resolved items. Keep short notes here so we remember what changed and why.

### Example completed item

**Type:** Docs  
**Completed:** YYYY-MM-DD  

Brief note about what was done.
