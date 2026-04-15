# Advance Game Time — Admin Endpoint

## What it does

This endpoint lets facilitators and testers **jump the in-game clock forward** without waiting for real time to pass. It is useful when you want to:

- Skip to a later point in the simulation quickly during testing.
- Trigger injections that are scheduled to appear later in the game.
- Reproduce a specific game state (e.g. "30 minutes into the simulation") on demand.

The game continues running normally after the time jump — paused or not, the clock reflects the new position as if that time had actually elapsed.

---

## How to call it

```
GET /admin/game/advance/:gameId?time=<minutes>
```

| Part      | Description                                                   |
| --------- | ------------------------------------------------------------- |
| `:gameId` | The ID of the game you want to advance (required).            |
| `?time=`  | How many minutes to jump forward (optional, default: **60**). |

The request must include the admin password in the `X-Admin-Password` header.

---

## Examples

**Advance by the default 60 minutes:**

```
GET /admin/game/advance/abc-123
X-Admin-Password: <your-password>
```

**Advance by 30 minutes:**

```
GET /admin/game/advance/abc-123?time=30
X-Admin-Password: <your-password>
```

**Advance by 2 hours (120 minutes):**

```
GET /admin/game/advance/abc-123?time=120
X-Admin-Password: <your-password> ("nothanks" for testing environments)
```

---

## What the response looks like

On success the endpoint returns `200 OK` with a JSON body:

```json
{
  "ok": true,
  "advancedMinutes": 60,
  "game": { ... }
}
```

The `game` object is the full updated game state, identical to what the UI receives after any normal game action.

---

## Rules and restrictions

| Condition                                  | What happens                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| Game is in **SIMULATION** state            | Time is advanced. Works whether the game is paused or running.                 |
| Game is in **PREPARATION** state           | Request is rejected with `409 INVALID_GAME_STATE`. Start the simulation first. |
| Game is in **ASSESSMENT** (finished)       | Request is rejected with `409 INVALID_GAME_STATE`.                             |
| Game ID not found                          | Request is rejected with `404 GAME_NOT_FOUND`.                                 |
| `?time` is zero, negative, or not a number | Request is rejected with `400 INVALID_TIME`.                                   |
| Missing or wrong admin password            | Request is rejected with `401`.                                                |

---

## Important notes

- **The time jump is permanent.** There is no undo. The game log will contain an entry recording that time was advanced by an admin.
- **Fractional minutes are accepted.** For example, `?time=1.5` advances by 90 seconds.
- **The jump does not automatically deliver injections.** The client UI is responsible for triggering injections based on the current game timer. After a time jump the UI will see that certain injections are now overdue and surface them normally.
- **This endpoint is for testing only.** Use it in development or QA environments. Advancing time in a live session with real participants will immediately shift the game clock without warning to connected players.
