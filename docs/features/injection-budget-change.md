# Feature: `budget_change` for Injection Events

## Overview

Add a `budget_change` field to injection events, mirroring the existing `poll_change` field. When an event is delivered, it can now reduce or increase the game budget in addition to (or instead of) affecting the poll percentage.

---

## Background

Injections (threat events) currently support a `poll_change` decimal field that shifts the campaign's support percentage on delivery. The `curveball` table already has both `poll_change` and `budget_change` fields. This feature brings budget impact parity to injections.

---

## Backend Changes

### 1. Migration — add `budget_change` column to `injection`

Create a new migration file, e.g. `migrations/<timestamp>_add_budget_change_to_injection.js`:

```js
exports.up = (knex) =>
  knex.schema.table('injection', (t) => {
    t.decimal('budget_change').nullable();
  });

exports.down = (knex) =>
  knex.schema.table('injection', (t) => {
    t.dropColumn('budget_change');
  });
```

### 2. Apply `budget_change` on delivery — `src/models/game.js`

In the `deliverGameInjection` function (around line 481), alongside the existing `poll_change` logic:

**Current logic (poll only):**
```js
// ~line 492
const { poll_change: pollChange } = injection;

// ~line 505
await trx('game')
  .where({ id: gameId })
  .update({
    poll: knex.raw(
      'GREATEST(0, LEAST(200, poll + ?))',
      [pollChange || 0]
    ),
  });
```

**Updated logic (poll + budget):**
```js
const { poll_change: pollChange, budget_change: budgetChange } = injection;

await trx('game')
  .where({ id: gameId })
  .update({
    poll: knex.raw(
      'GREATEST(0, LEAST(200, poll + ?))',
      [pollChange || 0]
    ),
    budget: knex.raw(
      'GREATEST(0, budget + ?)',
      [budgetChange || 0]
    ),
  });
```

The floor of 0 matches the convention already used for curveball budget changes (`Math.max(0, budget + budgetChange)`).

### 3. Seed data — `seeds/datasets/.../data/injection.json`

Add `"budget_change": null` (or a concrete value) to each injection object. Events that should not affect the budget keep `null`; those that should carry a value such as `-500` or `1000`.

Example:
```json
{
  "id": "some-id",
  "title": "Strategy Leaked",
  "poll_change": -3,
  "budget_change": -500,
  ...
}
```

### 4. Logging (optional but recommended) — `src/models/game.js`

The existing `game_log` entry created inside `deliverGameInjection` can be extended to include the budget delta, keeping it consistent with how curveball and campaign-action logs record budget impact:

```js
await trx('game_log').insert({
  game_id: gameId,
  game_timer: gameTimer,
  type: 'Threat Injected',
  details: JSON.stringify({
    injection_id: injectionId,
    poll_change: pollChange || 0,
    budget_change: budgetChange || 0,   // new
  }),
});
```

---

## Frontend Changes (`CyberSim-UI`)

### 1. `InjectionBody.jsx` — display `budget_change`

**File:** `src/components/Simulation/Injections/InjectionBody.jsx`

Alongside the existing `poll_change` display block (around line 72–76), add a budget change row:

```jsx
{injection.budget_change != null && (
  <p className={injection.delivered && !injection.prevented ? 'text-danger' : ''}>
    <strong>Budget impact:</strong>{' '}
    {injection.budget_change > 0 ? '+' : ''}
    {formatCurrency(injection.budget_change)}
    {injection.prevented && ' (avoided)'}
  </p>
)}
```

Use a `formatCurrency` helper (or inline `toLocaleString('en-US', { style: 'currency', currency: 'USD' })`) matching the display in `BPT.jsx`.

### 2. `EventLogs` — surface budget change in the "Threat Injected" log entry

**File:** `src/components/EventLogs/` (whichever component renders a delivered-injection log entry)

If the log `details` object now includes `budget_change`, render it the same way `CurveballEventLog.jsx` renders its `budget_change` field.

---

## Data Flow (updated)

```
Facilitator triggers injection (frontend)
  → socket.emit('deliverInjection', { injectionId })

Backend socketio.js → deliverGameInjection()
  → SELECT poll_change, budget_change FROM injection WHERE id = injectionId
  → UPDATE game SET
       poll   = GREATEST(0, LEAST(200, poll + poll_change)),
       budget = GREATEST(0, budget + budget_change)
     WHERE id = gameId
  → INSERT INTO game_log (type='Threat Injected', details={poll_change, budget_change})
  → io.emit('gameUpdated', updatedGame)

Frontend GameStore receives 'gameUpdated'
  → gameStore.poll and gameStore.budget updated
  → BPT.jsx re-renders with new budget
  → InjectionBody.jsx shows budget_change indicator
```

---

## Checklist

- [ ] Migration: `budget_change` column added to `injection` table
- [ ] `deliverGameInjection`: apply `budget_change` to game budget on delivery
- [ ] Seed data: `budget_change` values populated for relevant injections (null for no-ops)
- [ ] (Optional) game_log detail updated to include `budget_change`
- [ ] `InjectionBody.jsx`: display `budget_change` when non-null
- [ ] Event log component: render `budget_change` for delivered injections
- [ ] Manual QA: deliver an injection with a negative `budget_change` and confirm budget decreases correctly
- [ ] Manual QA: confirm prevented injections do not apply budget change
