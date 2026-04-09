# Feature: Projector — Purchased Budget Items Panel

## Summary

Add a panel to the projector screen that lists all budget items (mitigations) that have been purchased, grouped by category. This gives the facilitator and audience a live, at-a-glance view of which capabilities the team has bought during the Preparation and Simulation phases.

---

## Context & Data Model

### What already exists

- **`gameStore.mitigations`** — a map `{ [mitigationId]: boolean }` that reflects the purchase state of every mitigation, kept in sync via the `GAMEUPDATED` socket event.
- **`gameStore.preparationMitigations`** — same shape, specifically tracking items purchased during Preparation.
- **Static mitigation data** (loaded once by `StaticDataProvider`) — provides `description`, `cost`, `category`, `is_hq`, `is_local` for each mitigation ID.

### Key conclusion

**No backend changes are required.** The game state broadcast already contains purchase flags for every mitigation. The frontend already has all the static detail needed to render names, costs, and categories. This is a purely frontend feature.

---

## Implementation Plan

### Step 1 — Create `PurchasedMitigations` component

**File to create:** `CyberSim-UI/src/components/Projector/PurchasedMitigations.jsx`

Logic:

1. Read `gameStore.mitigations` (and `gameStore.preparationMitigations` for context) to get the set of purchased mitigation IDs.
2. Read static mitigation data from `StaticDataContext` (already provided by `StaticDataProvider`).
3. Filter to only purchased items (`mitigationState === true`).
4. Group by `category`.
5. For each category render a section header and a list of items showing:
   - Mitigation description
   - Cost in USD
   - Location badge (`HQ` / `Local` / `Both`) derived from `is_hq` / `is_local` flags

**Relevant existing patterns to follow:**
- `CyberSim-UI/src/components/Mitigations/Mitigations.jsx` — already groups mitigations by category and computes per-category totals; reuse the same grouping logic.
- `CyberSim-UI/src/components/Mitigations/MitigationCategory.jsx` — contains the per-item display structure.

Minimal component sketch:

```jsx
// PurchasedMitigations.jsx
import { view } from '@risingstack/react-easy-state';
import gameStore from '../GameStore';
import { useStaticData } from '../StaticDataProvider';

const PurchasedMitigations = view(() => {
  const { mitigations: staticMitigations } = useStaticData();
  const { mitigations } = gameStore;

  // Build list of purchased static mitigation records
  const purchased = Object.entries(mitigations)
    .filter(([, purchased]) => purchased)
    .map(([id]) => staticMitigations[id])
    .filter(Boolean);

  // Group by category
  const byCategory = purchased.reduce((acc, m) => {
    (acc[m.category] = acc[m.category] || []).push(m);
    return acc;
  }, {});

  if (purchased.length === 0) {
    return <p className="text-muted">No budget items purchased yet.</p>;
  }

  return (
    <div className="purchased-mitigations">
      {Object.entries(byCategory).map(([category, items]) => (
        <div key={category} className="mb-3">
          <h6 className="text-uppercase text-muted small">{category}</h6>
          <ul className="list-unstyled mb-0">
            {items.map((m) => (
              <li key={m.id} className="d-flex justify-content-between">
                <span>{m.description}</span>
                <span className="text-nowrap ml-2 text-success">
                  ${m.cost.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
});

export default PurchasedMitigations;
```

---

### Step 2 — Add the panel to `Projector.jsx`

**File to edit:** `CyberSim-UI/src/components/Projector.jsx`

Currently the Projector renders:
- `<BPT big />` — budget / poll / time
- `<Systems />` or `<EventLogs />` depending on game state

Add `<PurchasedMitigations />` as a new section. It should be visible during both `PREPARATION` and `SIMULATION` states (hide it on `ASSESSMENT` since the full event log is shown there instead and it would be redundant).

Suggested placement: below the BPT block, inside a card/panel with a clear heading such as **"Purchased Budget Items"**. The Systems section (or EventLogs) continues below it.

Diff outline for `Projector.jsx`:

```diff
+import PurchasedMitigations from './Projector/PurchasedMitigations';

 const Projector = view(() => {
   const { id, state: gameState } = gameStore;
   return (
     <Container fluid>
       <Row>...</Row>   {/* Game ID header */}
       <Row>
         <Col><BPT big /></Col>
       </Row>
+      {gameState !== 'ASSESSMENT' && (
+        <Row className="mt-3">
+          <Col>
+            <Card>
+              <Card.Header><strong>Purchased Budget Items</strong></Card.Header>
+              <Card.Body><PurchasedMitigations /></Card.Body>
+            </Card>
+          </Col>
+        </Row>
+      )}
       <Row className="mt-3">
         <Col>
           {gameState === 'ASSESSMENT' ? <EventLogs /> : <Systems />}
         </Col>
       </Row>
     </Container>
   );
 });
```

---

### Step 3 — Handle Preparation vs. Simulation display distinction (optional enhancement)

During **Preparation**, items in `gameStore.preparationMitigations` (or the `preparation` flag in the game state) were purchased with the prep budget. During **Simulation** the budget resets, so purchased items remain active but no new purchases happen in the same way.

If the facilitator wants to distinguish prep-phase purchases from simulation-phase purchases, `PurchasedMitigations` can accept a prop or read `gameStore.preparationMitigations` to add a badge (e.g., "Prep") next to items that were bought in Preparation.

This is optional and can be deferred to a follow-up.

---

## Files Touched

| Repo | File | Change |
|------|------|--------|
| CyberSim-UI | `src/components/Projector/PurchasedMitigations.jsx` | **Create** — new component |
| CyberSim-UI | `src/components/Projector.jsx` | **Edit** — import and render `PurchasedMitigations` |

No backend changes. No new socket events. No database migrations.

---

## Acceptance Criteria

1. The projector screen shows a **"Purchased Budget Items"** section during `PREPARATION` and `SIMULATION` game states.
2. The list updates in real time whenever a team member purchases or removes a mitigation (driven by the existing `GAMEUPDATED` socket broadcast).
3. Items are grouped by category with the category name as a header.
4. Each item shows its description and cost.
5. When no items have been purchased, the section shows a neutral "No budget items purchased yet." message.
6. The section is hidden during the `ASSESSMENT` state (where the full event log is already displayed).
