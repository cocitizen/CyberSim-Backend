# Mitigation-Linked Responses

**Feature**: Tie event responses directly to buying `purchased_mitigations`

When a player purchases a specific mitigation during the **SIMULATION** phase, the backend automatically applies a pre-configured response to any delivered, unresolved event that has that mitigation set as its activating mitigation. Buying the right defensive tool *is* the response to the attack.

---

## Background

Two existing (but one-directional) relationships already exist between responses and mitigations:

| Field | Table | Meaning |
|---|---|---|
| `response.mitigation_id` | `response` | Making this response also purchases/enables this mitigation |
| `response.required_mitigation` | `response` | This mitigation must be purchased before the response can be selected |

This feature adds the **reverse** of `mitigation_id`: purchasing a mitigation can auto-apply a response.

---

## Data Model Change

Add a nullable FK column to the `response` table:

```
response.activating_mitigation_id  →  mitigation.id
```

When set, purchasing the referenced mitigation during SIMULATION automatically resolves the event as though the facilitator had selected this response manually.

### Migration

```js
// migrations/20260325000001_response_activating_mitigation.js
exports.up = (knex) =>
  knex.schema.alterTable('response', (tbl) => {
    tbl.integer('activating_mitigation_id')
       .nullable()
       .references('id').inTable('mitigation');
  });

exports.down = (knex) =>
  knex.schema.alterTable('response', (tbl) => {
    tbl.dropColumn('activating_mitigation_id');
  });
```

---

## Backend Changes

### `src/models/game.js` — `changeMitigation()`

Inside the existing `if (game.state !== GameStates.PREPARATION)` block, after the injection-prevention and game-log logic, add auto-response logic when `mitigationValue` is `true`:

```js
// --- Auto-apply responses activated by this mitigation purchase ---
if (mitigationValue) {
  const activatingPairs = await db('game_injection as gi')
    .join('injection_response as ir', 'ir.injection_id', 'gi.injection_id')
    .join('response as r', 'r.id', 'ir.response_id')
    .select(
      'gi.injection_id',
      'r.id as response_id',
      'r.systems_to_restore as systemsToRestore',
    )
    .where({
      'gi.game_id': gameId,
      'gi.delivered': true,
      'r.activating_mitigation_id': mitigationId,
    })
    .whereNull('gi.response_made_at');

  for (const { injection_id, response_id, systemsToRestore } of activatingPairs) {
    if (systemsToRestore?.length) {
      await db('game_system')
        .where({ game_id: gameId })
        .whereIn('system_id', systemsToRestore)
        .update({ state: true });
    }

    const { followupInjection } = await db('injection')
      .select('followup_injection as followupInjection')
      .where('id', injection_id)
      .first();

    if (followupInjection) {
      await db('game_injection')
        .where({ game_id: gameId, delivered: false, injection_id: followupInjection })
        .update({ prevented: true, prevented_at: timeTaken });
    }

    await db('game_injection')
      .where({ game_id: gameId, injection_id })
      .update({
        predefined_responses_made: [response_id],
        is_response_correct: true,
        response_made_at: timeTaken,
      });
  }
}
```

### No changes required

- `src/models/response.js` — queries use `response.*`, new column is included automatically.
- `src/models/injection.js` — uses `array_agg(to_json(response))`, new column is included automatically.
- REST routes — no changes needed.

---

## Frontend Changes

### `InjectionResponseForm.jsx`

Split the injection's `responses` array into two groups:

```js
// Regular selectable responses (no activating_mitigation_id)
const regularResponses = useMemo(
  () =>
    injection.responses?.filter(
      ({ required_mitigation, activating_mitigation_id }) =>
        !activating_mitigation_id &&
        (!required_mitigation || gameMitigations[required_mitigation]),
    ),
  [injection, gameMitigations],
);

// Responses that are auto-applied by buying a mitigation
const activatingResponses = useMemo(
  () =>
    injection.responses?.filter(({ activating_mitigation_id }) =>
      activating_mitigation_id,
    ),
  [injection],
);
```

Render `regularResponses` as normal toggle switches (existing behaviour). Below them, add an informational section:

```jsx
{activatingResponses?.length > 0 && (
  <div className="mt-2 border-top pt-2">
    <small className="text-muted font-weight-bold d-block mb-1">
      AUTO-RESOLVED BY MITIGATION PURCHASE:
    </small>
    {activatingResponses.map((response) => {
      const mitigationName =
        mitigations[response.activating_mitigation_id]?.description ??
        `Mitigation #${response.activating_mitigation_id}`;
      const alreadyApplied =
        gameInjection?.predefined_responses_made?.includes(response.id);
      const mitigationPurchased =
        gameMitigations[response.activating_mitigation_id];

      return (
        <div key={response.id} className="py-1 d-flex align-items-center">
          <AiOutlineCheck className="mr-2 text-success" fontSize="16px" />
          <span className={alreadyApplied ? 'text-muted' : ''}>
            {response.description}{' '}
            <Badge
              variant={mitigationPurchased ? 'success' : 'warning'}
            >
              {mitigationPurchased
                ? `Applied via: ${mitigationName}`
                : `Buy "${mitigationName}" to auto-apply`}
            </Badge>
          </span>
        </div>
      );
    })}
  </div>
)}
```

> `mitigations` (static reference data) is available from `useStaticData()`, already imported in the component.

---

### `MitigationCategory.jsx`

Pass a `Set<mitigationId>` prop (`resolvingActiveEvents`) down from the parent, computed as:

```js
// In the parent component (e.g. Mitigations.jsx or the simulation wrapper)
const activeResolvingMitigationIds = useMemo(() => {
  const ids = new Set();
  Object.values(staticInjections).forEach((inj) => {
    const gi = gameInjections[inj.id];
    if (gi?.delivered && !gi?.response_made_at) {
      inj.responses?.forEach((r) => {
        if (r.activating_mitigation_id) ids.add(r.activating_mitigation_id);
      });
    }
  });
  return ids;
}, [staticInjections, gameInjections]);
```

In `MitigationCategory.jsx`, show a badge next to the description when relevant:

```jsx
<Col xs={11}>
  {mitigation.description}
  {resolvingActiveEvents?.has(mitigation.id) && (
    <Badge variant="danger" className="ml-2">
      Resolves active event
    </Badge>
  )}
</Col>
```

---

## Seed / Airtable Import

Add `activating_mitigation_id` as a mappable field in:

- Airtable import utility (`src/util/importScenarioFromAirtable.js`) — map from an Airtable `Activating Mitigation` linked-record field on the **Responses** table.
- Seed files — add the field to any response records that should trigger auto-resolution on mitigation purchase.

This lets scenario designers configure the mechanic through the data layer without code changes.

---

## Interaction with Existing Mechanics

| Scenario | Behaviour |
|---|---|
| Mitigation purchased in **PREPARATION** | No auto-response (events not yet delivered) |
| Mitigation purchased in **SIMULATION**, event already resolved | No-op (query filters `WHERE response_made_at IS NULL`) |
| Mitigation purchased in **SIMULATION**, event delivered and unresolved | Response auto-applied; systems restored; followup injection prevented |
| Mitigation sold back (value=false) | Auto-responses are **not** reversed (already committed) |
| Same mitigation is also `skipper_mitigation` on an undelivered injection | Both prevention and auto-response logic fire independently |

---

## Files Changed

| Layer | File | Change |
|---|---|---|
| DB | `migrations/20260325000001_response_activating_mitigation.js` | Add `response.activating_mitigation_id` FK |
| Backend | `src/models/game.js` | Auto-apply responses in `changeMitigation()` |
| Frontend | `src/components/Simulation/Injections/InjectionResponseForm.jsx` | Informational auto-resolve section |
| Frontend | `src/components/Mitigations/MitigationCategory.jsx` | "Resolves active event" badge |
| Data | Airtable import + seed files | Map new field |