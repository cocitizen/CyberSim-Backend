# Airtable Schema Reference

This describes the exact structure the importer expects to find in an Airtable
base — every table, field, and link it reads. If your base matches this, the
import will succeed; if it does not, the import fails with a validation error
and writes nothing.

The schema is defined in code, in
[`src/util/import_schemas.js`](../src/util/import_schemas.js) (the
`airtableSchemas` object). That file is the source of truth — this document is
a human-readable rendering of it. If the two ever disagree, the code wins, and
this doc should be corrected.

For credentials, base IDs, and access tokens, see
[`airtable-handbook.md`](./airtable-handbook.md). For the full new-scenario
workflow, see [`scenario-setup.md`](./scenario-setup.md).

## Two rules that trip people up

1. **Table and field names must match exactly — including underscores and
   case.** The importer reads Airtable columns by their literal names. A field
   must be named `budget_change`, not `Budget Change` or `budgetChange`. A
   mis-named column reads as missing.

2. **Links between tables are Airtable "Link to another record" fields**
   pointing at the named table. Where the schema below says **link (single)**,
   the importer uses the *first* linked record and ignores the rest. Where it
   says **link (multiple)**, it uses *all* linked records.

## How to read this reference

- **Required** fields must be present and non-empty on every row. A blank cell
  on a required field fails the import.
- **Optional** fields may be left blank.
- **Extra columns are ignored.** You can keep helper columns, notes, or
  formatting fields in Airtable; the importer strips anything not listed here.
- **`id` is automatic.** Every table is keyed by Airtable's own record id
  (`rec...`). You do not create an `id` column — Airtable provides it.
- **Each table is read through a view literally named `Grid view`.** That is
  Airtable's default view name. If you rename or delete it, the import fails
  for that table. (See [Error messages](#error-messages) below.)

Tables come in two kinds:

- **Content tables** become rows in the database (injections, responses,
  mitigations, etc.).
- **Lookup tables** exist only to resolve names and links during import. They
  are not stored directly, but the content tables link to them, so they must
  exist and be named correctly.

---

## Content tables

### `events` → injections

The core scenario events. (Stored in the database as `injection` rows.)

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | text | **Yes** | |
| `description` | text | **Yes** | |
| `trigger_time` | number | **Yes** | Positive integer, **in seconds**. The importer multiplies by 1000 to store milliseconds. |
| `event_types` | link (single) → `event_types` | No | Determines the injection type. Defaults to `Board` if unset. |
| `locations` | link (single) → `locations` | No | |
| `role` | link (single) → `roles` | No | Recipient role. |
| `recommendations` | link (multiple) → `recommendations` | No | |
| `handbook_category` | link (single) → `handbook_categories` | No | |
| `systems_to_disable` | link (multiple) → `systems` | No | |
| `response` | link (multiple) → `responses` | No | Valid responses to this injection. |
| `skipper_mitigation` | link (single) → `purchased_mitigations` | No | Mitigation that pre-empts this injection. |
| `followup_event` | link (single) → `events` | No | Self-link to a follow-up event. |
| `spreadsheet_id` | number | No | Positive integer. Stored as the injection's `asset_code`. |
| `poll_change` | number | No | |
| `budget_change` | number | No | May be left blank (nullable). |

### `purchased_mitigations` → mitigations

Mitigations players can buy during the opening purchase phase. (Stored as
`mitigation` rows.)

| Field | Type | Required | Notes |
|---|---|---|---|
| `description` | text | **Yes** | |
| `category` | link (single) → `purchased_mitigations_category` | **Yes** | |
| `cost` | number | No | |

> Display order within each category is controlled by the row order in
> Airtable. See "Purchased Mitigations" in
> [`airtable-handbook.md`](./airtable-handbook.md).

### `responses`

Player responses to injections.

| Field | Type | Required | Notes |
|---|---|---|---|
| `description` | text | **Yes** | |
| `cost` | number | No | |
| `mitigation_id` | link (single) → `purchased_mitigations` | No | |
| `required_mitigation` | link (single) → `purchased_mitigations` | No | |
| `systems_to_restore` | link (multiple) → `systems` | No | |

### `systems`

IT systems that can be disabled and restored during play.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | text | **Yes** | |
| `locations` | link (multiple) → `locations` | **Yes** | A system linked to **both** `hq` and `local` is treated as a `party`-wide system. |
| `description` | text | No | |

### `roles`

Player roles.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | text | **Yes** | |

### `actions`

Proactive actions players can take.

| Field | Type | Required | Notes |
|---|---|---|---|
| `description` | text | **Yes** | |
| `locations` | link (single) → `locations` | **Yes** | |
| `cost` | number | No | |
| `budget_increase` | number | No | |
| `poll_increase` | number | No | |
| `required_systems` | link (multiple) → `systems` | No | |
| `role` | link (multiple) → `roles` | No | |

### `curveballs`

| Field | Type | Required | Notes |
|---|---|---|---|
| `description` | text | **Yes** | |
| `poll_change` | number | No | |
| `budget_change` | number | No | |

### `locations`

| Field | Type | Required | Notes |
|---|---|---|---|
| `location_code` | text | **Yes** | Must be exactly `hq` or `local`. **Do not change these values** — application logic depends on them. |
| `name` | text | No | Display name; safe to customize. |

### `dictionary`

Terminology overrides (e.g. renaming "poll" or "budget").

| Field | Type | Required | Notes |
|---|---|---|---|
| `word` | text | **Yes** | |
| `synonym` | text | **Yes** | |

---

## Lookup tables

These are not stored as their own database rows, but the content tables link to
them, so they must exist with the correct names.

### `event_types`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | text | No | Must be one of `Table`, `Background`, or `System Board`. `System Board` maps to the internal type `Board`. Unrecognized values fall back to `Board`. |

### `purchased_mitigations_category`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | text | No | Category label for grouping purchased mitigations. |

### `handbook_categories`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | text | No | |

### `recommendations`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | text | No | Resolved during import to `"<handbook category>: <name>"`. |
| `handbook_category` | link (single) → `handbook_categories` | No | |

---

## What the importer does for you

Some values are transformed during import — author the Airtable values, not the
stored values:

- **`trigger_time`** is authored in **seconds**; the importer stores
  milliseconds (×1000).
- **`event_types`** named `System Board` is stored as type `Board`.
- **`spreadsheet_id`** becomes the injection's `asset_code` (as a string).
- **`recommendations`** are stored as `"<handbook category>: <name>"`.
- A **system** linked to both `hq` and `local` is stored with location type
  `party`.
- **Unknown columns are dropped**, so extra Airtable fields never break an
  import.

## Error messages

When validation fails, the import makes no changes and the UI shows the errors.
The common ones map back to this schema as follows:

| Message | Cause | Fix |
|---|---|---|
| `<field> is a required field in <table>` | A required column is missing, mis-named, or blank on some row. The offending row's contents are shown beneath the message. | Add/rename the column to match this reference exactly, or fill in the blank cell. |
| `<field> must be a `number`/`integer`` in `<table>` | A cell that should be numeric contains text. | Change the Airtable field type to Number, or fix the value. |
| `location_code must be one of the following values: hq, local` | A `locations` row has a `location_code` other than `hq` or `local`. | Set it to exactly `hq` or `local`. |
| `A schema error occurred when querying the <table> table` | The table is missing or mis-named, or its `Grid view` was renamed/deleted. | Create the table with the exact name above and ensure it has a view named `Grid view`. |
| Airtable authorization error / token scopes | The access token cannot read the base. | Check the base is on the token's access list and that it has the `data.records:read` and `schema.bases:read` scopes. See [`airtable-handbook.md`](./airtable-handbook.md). |

All of these checks run *before* any data is written. A failed import never
modifies the database — fix the reported issues and re-run.
