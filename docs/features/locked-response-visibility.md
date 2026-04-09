# Locked Response Visibility in Event Widget

**Feature**: Show mitigation-gated responses as greyed-out/unselectable in the event response form even when the required mitigation has not yet been purchased.

Currently, responses that require a specific mitigation to be purchased are **hidden entirely** if that mitigation is absent. The desired behaviour is to **always show them**, but render them as disabled with a visual cue indicating which mitigation must be purchased to unlock them. This gives facilitators a coaching signal during gameplay.

---

## Background

The `response` table has a `required_mitigation` FK column. When set, a player can only submit that response if the referenced mitigation is active in their game. The frontend currently enforces this by filtering out locked responses before rendering — they simply never appear in the UI.

The backend already validates `required_mitigation` on submission (`game.js → makeResponses()`), so showing a locked response on the frontend will not allow it to be submitted; the server-side guard remains unchanged.

---

## Scope

**Backend**: No changes required.
All necessary data (`required_mitigation`, `description`) is already returned by the existing `GET /injections` and `GET /mitigations` REST endpoints and flows through `StaticDataProvider`.

**Frontend**: Single file change — `InjectionResponseForm.jsx`.

---

## Frontend Changes

### File: `src/components/Simulation/Injections/InjectionResponseForm.jsx`

#### 1. Pull `mitigations` from static data (line 16)

`mitigations` is already available from `useStaticData()` but not currently destructured in this component. Add it:

```js
// Before
const { responses, systems } = useStaticData();

// After
const { responses, systems, mitigations } = useStaticData();
```

#### 2. Replace the `availableResponses` filter with two derived lists (lines 125–133)

```js
// Before — locked responses are excluded entirely
const availableResponses = useMemo(
  () =>
    injection.responses?.filter(
      ({ required_mitigation: requiredMitigationId }) =>
        !requiredMitigationId ||
        gameMitigations[requiredMitigationId],
    ),
  [injection, gameMitigations],
);

// After — all responses included; split by lock status
const unlockedResponses = useMemo(
  () =>
    injection.responses?.filter(
      ({ required_mitigation: requiredMitigationId }) =>
        !requiredMitigationId || gameMitigations[requiredMitigationId],
    ),
  [injection, gameMitigations],
);

const lockedResponses = useMemo(
  () =>
    injection.responses?.filter(
      ({ required_mitigation: requiredMitigationId }) =>
        requiredMitigationId && !gameMitigations[requiredMitigationId],
    ),
  [injection, gameMitigations],
);
```

#### 3. Update the render loop (line 165)

Change `availableResponses` → `unlockedResponses` in the existing map, then add a second map for locked responses immediately after it, inside the same `<Col xs={12}>`:

```jsx
{/* Existing loop — rename only */}
{unlockedResponses?.map((response) => (
  <Form.Check
    {/* ... existing props unchanged ... */}
  />
))}

{/* New section — locked responses */}
{lockedResponses?.map((response) => {
  const requiredMitigationName =
    mitigations[response.required_mitigation]?.description ??
    'a required mitigation';
  return (
    <Form.Check
      type="switch"
      className="py-1 text-muted"
      style={{ width: 'fit-content', opacity: 0.5, cursor: 'not-allowed' }}
      key={`${injection.id}_${response.id}_locked`}
      id={`${injection.id}_${response.id}_locked`}
      label={
        <span style={{ fontStyle: 'italic' }}>
          {response.description} (Cost: ${responses[response.id].cost})
          {' — '}
          <small className="text-muted">
            Requires: {requiredMitigationName}
          </small>
        </span>
      }
      disabled={true}
      checked={false}
      onChange={() => {}}
    />
  );
})}
```

> **Why `disabled={true}` instead of omitting `onChange`**: React requires `onChange` when `checked` is controlled. `disabled={true}` prevents interaction and provides the native browser greyed-out affordance on top of the opacity style.

---

## Visual Result

| State | Appearance |
|---|---|
| Mitigation **purchased** | Normal toggle switch, fully interactive (unchanged) |
| Mitigation **not purchased** | Greyed-out switch (50% opacity, italic label), disabled, with "Requires: `<mitigation description>`" hint |
| Response has **no required mitigation** | Normal toggle switch (unchanged) |

---

## Files Changed

| Layer | File | Change |
|---|---|---|
| Frontend | `src/components/Simulation/Injections/InjectionResponseForm.jsx` | Add `mitigations` to destructuring; split `availableResponses` into `unlockedResponses` / `lockedResponses`; render locked responses as disabled switches with hint text |

---

## What Stays the Same

- **Backend validation** — `makeResponses()` still rejects any submission that includes a locked response ID. The frontend guard merely becomes a visual cue rather than a hard filter.
- **Post-response display** — `madeResponses` rendering (showing which responses were selected after an event is resolved) is unaffected; locked responses will never appear in `predefined_responses_made`.
- **Cost / systems-restored summary** — locked responses are not selectable, so they never contribute to `formStore.responseCost` or `formStore.restoredSystems`.
