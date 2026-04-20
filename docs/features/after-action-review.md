# Feature: After Action Review (AAR) Page

## Overview

Build a facilitator-facing After Action Review page that renders a visual timeline of all injection events from a completed game. Each event is displayed as a card showing the event chain: initial threat → player response (correct/incorrect) → follow-up event (avoided/triggered). Cards are collapsed by default (showing only the key takeaway) and expandable to show full detail including preventative purchases, response options, and impacts.

This feature replaces the current ASSESSMENT-state view (which just shows EventLogs + BPT) with a purpose-built review page. **No new dependencies** — uses only React Bootstrap, existing SCSS, and data already available from the backend.

---

## Color Coding

| Color  | Meaning | When Used |
|--------|---------|-----------|
| Black  | Regular event | Scripted injection delivered normally |
| Blue   | Prevented event | Injection never delivered because a budget purchase blocked it |
| Green  | Follow-up avoided | Follow-up event was prevented by a correct player response |
| Red    | Follow-up not avoided | Follow-up event occurred because the player response was incorrect/missing |
| Orange | Threat mitigation | A post-event mitigation action was taken (e.g., paid ransom, restored from backup) |

---

## Data Requirements

### What the backend already provides

All data needed for the AAR is **already available** from the existing `getGame()` response and static data endpoints. No new backend endpoints are strictly required for an MVP.

**From `gameStore` (dynamic game state via Socket.IO `gameUpdated`):**
- `game.injections[]` → each `game_injection` row:
  - `injection_id`, `delivered`, `delivered_at`, `prevented`, `prevented_at`
  - `predefined_responses_made[]`, `is_response_correct`, `response_made_at`
  - `custom_response`
- `game.mitigations[]` → each `game_mitigation` row:
  - `mitigation_id`, `state` (purchased?), `preparation` (bought in prep phase?)
- `game.logs[]` → each `game_log` row:
  - `game_timer`, `type`, `description`, `mitigation_id`, `response_id`, `action_id`, `curveball_id`
- `game.poll`, `game.budget` → final values

**From `StaticDataProvider` (REST endpoints, keyed by ID):**
- `injections[id]` → `title`, `description`, `trigger_time`, `location`, `type`, `recipient_role`, `asset_code`, `recommendations`, `systems_to_disable[]`, `poll_change`, `skipper_mitigation`, `followup_injection`, `responses[]`
- `responses[id]` → `description`, `cost`, `mitigation_id`, `systems_to_restore[]`, `required_mitigation`
- `mitigations[id]` → `description`, `cost`, `category`
- `systems[id]` → `name`, `description`, `type`

### Derived data (computed on the frontend)

The AAR page must compute **event chains** by linking:
1. An injection → its `followup_injection` (from static injection data)
2. An injection → its `skipper_mitigation` (which mitigation prevents it)
3. A `game_injection` → whether the followup was prevented/delivered
4. A `game_injection` → which responses were made (`predefined_responses_made[]`)
5. A mitigation → when it was purchased (from `game_log` entries of type `Budget Item Purchase`)

---

## Backend Changes

### New REST Endpoint: `GET /games/:gameId/aar`

While the frontend *could* compute everything client-side, a dedicated endpoint simplifies the frontend and ensures consistent chain-building logic. This endpoint returns a pre-assembled array of event chains for the AAR.

**File:** `src/app.js` (new route) + `src/models/aar.js` (new model)

#### `src/models/aar.js`

```js
const db = require('./db');

const getAARData = async (gameId) => {
  // 1. Fetch game state
  const game = await db('game')
    .select('id', 'poll', 'budget')
    .where({ id: gameId })
    .first();

  if (!game) throw new Error('Game not found');

  // 2. Fetch all game_injections with their static injection data
  const gameInjections = await db('game_injection')
    .select(
      'game_injection.*',
      'injection.title',
      'injection.description',
      'injection.trigger_time',
      'injection.location',
      'injection.type',
      'injection.recipient_role',
      'injection.asset_code',
      'injection.recommendations',
      'injection.systems_to_disable',
      'injection.poll_change',
      'injection.skipper_mitigation',
      'injection.followup_injection',
    )
    .join('injection', 'game_injection.injection_id', 'injection.id')
    .where({ 'game_injection.game_id': gameId });

  // 3. Fetch all injection_response join rows (which responses belong to which injection)
  const injectionResponses = await db('injection_response')
    .select('injection_response.*', 'response.*')
    .join('response', 'injection_response.response_id', 'response.id');

  // 4. Fetch game mitigations (purchased state)
  const gameMitigations = await db('game_mitigation')
    .select('game_mitigation.*', 'mitigation.description', 'mitigation.cost', 'mitigation.category')
    .join('mitigation', 'game_mitigation.mitigation_id', 'mitigation.id')
    .where({ 'game_mitigation.game_id': gameId });

  // 5. Fetch game logs for mitigation purchase timestamps
  const mitigationLogs = await db('game_log')
    .select('game_timer', 'mitigation_id')
    .where({ game_id: gameId, type: 'Budget Item Purchase' });

  // 6. Fetch game logs for response timestamps (system restores done post-event)
  const responseLogs = await db('game_log')
    .select('game_timer', 'response_id')
    .where({ game_id: gameId, type: 'System Restore Action' });

  // 7. Build event chains
  // Index game_injections by injection_id for quick lookup
  const giByInjectionId = {};
  gameInjections.forEach((gi) => {
    giByInjectionId[gi.injection_id] = gi;
  });

  // Index injection_responses by injection_id
  const responsesByInjectionId = {};
  injectionResponses.forEach((ir) => {
    if (!responsesByInjectionId[ir.injection_id]) {
      responsesByInjectionId[ir.injection_id] = [];
    }
    responsesByInjectionId[ir.injection_id].push(ir);
  });

  // Index mitigation purchase logs by mitigation_id
  const mitigationPurchaseTime = {};
  mitigationLogs.forEach((log) => {
    mitigationPurchaseTime[log.mitigation_id] = log.game_timer;
  });

  // Index game mitigations by mitigation_id
  const gmByMitigationId = {};
  gameMitigations.forEach((gm) => {
    gmByMitigationId[gm.mitigation_id] = gm;
  });

  // Find which injections are followups of other injections (so we skip them as top-level)
  const followupIds = new Set();
  gameInjections.forEach((gi) => {
    if (gi.followup_injection) {
      followupIds.add(gi.followup_injection);
    }
  });

  // Build chains: only top-level injections (not followups of another)
  const chains = gameInjections
    .filter((gi) => !followupIds.has(gi.injection_id))
    .sort((a, b) => a.trigger_time - b.trigger_time)
    .map((gi) => {
      const chain = buildChainEntry(gi, giByInjectionId, responsesByInjectionId, gmByMitigationId, mitigationPurchaseTime);
      return chain;
    });

  return { game, chains, mitigations: gameMitigations };
};

function buildChainEntry(gi, giByInjectionId, responsesByInjectionId, gmByMitigationId, mitigationPurchaseTime) {
  const possibleResponses = responsesByInjectionId[gi.injection_id] || [];

  // Determine event category
  let category; // 'prevented' | 'injected'
  if (gi.prevented) {
    category = 'prevented';
  } else if (gi.delivered) {
    category = 'injected';
  } else {
    category = 'not_delivered'; // edge case: game ended before trigger time
  }

  // Skipper mitigation info
  let skipperMitigation = null;
  if (gi.skipper_mitigation) {
    const gm = gmByMitigationId[gi.skipper_mitigation];
    skipperMitigation = {
      mitigation_id: gi.skipper_mitigation,
      description: gm?.description || null,
      purchased: gm?.state || false,
      purchased_in_preparation: gm?.preparation || false,
      purchased_at: mitigationPurchaseTime[gi.skipper_mitigation] ?? (gm?.preparation ? 0 : null),
    };
  }

  // Response info
  const responsesMade = (gi.predefined_responses_made || []).map((rId) => {
    const resp = possibleResponses.find((r) => r.response_id === rId) || {};
    return {
      response_id: rId,
      description: resp.description || null,
      cost: resp.cost || null,
      mitigation_id: resp.mitigation_id || null,
      systems_to_restore: resp.systems_to_restore || [],
    };
  });

  // Follow-up injection
  let followup = null;
  if (gi.followup_injection) {
    const followupGi = giByInjectionId[gi.followup_injection];
    if (followupGi) {
      followup = {
        injection_id: followupGi.injection_id,
        title: followupGi.title,
        description: followupGi.description,
        trigger_time: followupGi.trigger_time,
        poll_change: followupGi.poll_change,
        systems_to_disable: followupGi.systems_to_disable,
        delivered: followupGi.delivered,
        delivered_at: followupGi.delivered_at,
        prevented: followupGi.prevented,
        prevented_at: followupGi.prevented_at,
        recommendations: followupGi.recommendations,
        possible_responses: responsesByInjectionId[followupGi.injection_id] || [],
        responses_made: (followupGi.predefined_responses_made || []),
        is_response_correct: followupGi.is_response_correct,
        response_made_at: followupGi.response_made_at,
        custom_response: followupGi.custom_response,
      };
    }
  }

  return {
    injection_id: gi.injection_id,
    title: gi.title,
    description: gi.description,
    trigger_time: gi.trigger_time,
    location: gi.location,
    type: gi.type,
    recipient_role: gi.recipient_role,
    asset_code: gi.asset_code,
    recommendations: gi.recommendations,
    systems_to_disable: gi.systems_to_disable,
    poll_change: gi.poll_change,

    // Game-specific state
    category,
    delivered: gi.delivered,
    delivered_at: gi.delivered_at,
    prevented: gi.prevented,
    prevented_at: gi.prevented_at,

    // What prevented this event (if anything)
    skipper_mitigation: skipperMitigation,

    // Player responses
    possible_responses: possibleResponses,
    responses_made: responsesMade,
    is_response_correct: gi.is_response_correct,
    response_made_at: gi.response_made_at,
    custom_response: gi.custom_response,

    // Follow-up event chain
    followup,
  };
}

module.exports = { getAARData };
```

#### Route in `src/app.js`

```js
const { getAARData } = require('./models/aar');

app.get('/games/:gameId/aar', async (req, res, next) => {
  try {
    const data = await getAARData(req.params.gameId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});
```

### Why a dedicated endpoint?

1. **Chain assembly** — linking injections → followups → responses → mitigations requires joining 5+ tables. Doing this server-side avoids duplicating the logic on the client.
2. **Performance** — one request vs. the client correlating data from 6+ static endpoints + game state.
3. **Separation** — the AAR view is read-only and only used in ASSESSMENT state; it shouldn't couple to the real-time game state socket.

---

## Frontend Changes

### 1. New Component: `AfterActionReview.jsx`

**Location:** `src/components/AfterActionReview/AfterActionReview.jsx`

This is the top-level page component that replaces the current `Projector` view in ASSESSMENT state.

```
src/components/AfterActionReview/
├── AfterActionReview.jsx       # Page container: fetches AAR data, renders header + timeline
├── AARTimeline.jsx             # Ordered list of AAREventChain components
├── AAREventChain.jsx           # Single event chain: parent event + response + followup
├── AAREventCard.jsx            # Individual event card (collapsed/expanded)
├── AARResponseIndicator.jsx    # Correct/incorrect response badge with response name
├── AARFollowupCard.jsx         # Follow-up event card (avoided/not avoided)
├── AARMitigationBadge.jsx      # Shows which mitigation prevented the event + timestamp
└── AARExpandedDetails.jsx      # Expanded card content: actions to prevent, policy/tech options
```

### 2. Component Details

#### `AfterActionReview.jsx` (page)

```jsx
// Fetches GET /games/:gameId/aar on mount
// Renders:
//   - Header with game ID + final BPT
//   - AARTimeline with the chains array
// No socket dependency — pure REST read
```

**Data fetching:** `useEffect` with `axios.get(`${apiBase}/games/${gameId}/aar`)` on mount. Store result in local `useState`. Show spinner while loading.

#### `AARTimeline.jsx`

Receives the `chains[]` array. Renders each chain as an `AAREventChain`, ordered by `trigger_time`.

#### `AAREventChain.jsx`

The core visual unit. For each chain entry, renders:

1. **Parent event card** (`AAREventCard`)
   - Header bar color based on category:
     - `prevented` → blue header: `"EVENT PREVENTED thanks to... {MITIGATION_NAME}"`
     - `injected` → black header: `"THREAT INJECTED"`
     - `not_delivered` → gray header: `"NOT REACHED"` (game ended before trigger)
   - Collapsed view shows: title, description snippet, key takeaways (from `recommendations`)
   - Expanded view adds:
     - "Actions to prevent event" — list all `possible_responses` with checkmarks next to ones in `responses_made[]`, with timestamps
     - "Policy or tech to prevent worst impacts" — list mitigation options with checkmarks + timestamps for ones taken
     - Systems disabled, poll impact, budget impact

2. **Response indicator** (between parent and followup)
   - If `is_response_correct === true`: green thumbs-up + response description + "Correct response: {RESPONSE_NAME}"
   - If `is_response_correct === false`: red thumbs-down + "Incorrect response: {RESPONSE_NAME}"
   - If no response made: gray "No response"

3. **Follow-up event** (`AARFollowupCard`) — only if `followup` exists
   - If `followup.prevented`:
     - Green header: `"EVENT AVOIDED"` + `"AVOIDED DAMAGE: {poll_change}%"`
     - Shows: title, "Preventive response taken: {RESPONSE_NAME}"
   - If `followup.delivered`:
     - Red header: `"FOLLOW UP EVENT"` + `"POLLS: {poll_change}%"`
     - Shows: title, poll/budget impact
   - If followup has its own mitigation response taken (e.g., "PAY RANSOMWARE"):
     - Orange section: `"THREAT MITIGATION"` + cost/description

4. **Connecting visual** between cards
   - A vertical dashed line with chevrons (` ≫ `) and text like "Followup event" or "Correct response: REFORMAT COMPUTERS"
   - Use CSS `::before`/`::after` pseudo-elements on a connector div

#### `AAREventCard.jsx`

The expand/collapse card. Two states:

**Collapsed (default):**
```
┌─────────────────────────────────────────────────────┐
│ 12:00 - THREAT INJECTED                             │  ← colored header bar
├─────────────────────────────────────────────────────┤
│ Photo sharing on infected personal USB              │
│ New hire uses personal USB to share photos...       │
│                                                     │
│ Key Takeaways:                                      │
│ - USBs are frequently vectors of malware            │
│ - Advanced malware detection can help limit risk    │
│ - Backups are key, can eliminate need to pay ransom  │
│                                          + Expand   │
└─────────────────────────────────────────────────────┘
```

**Expanded (on click):**
```
┌─────────────────────────────────────────────────────┐
│ 12:00 - THREAT INJECTED                             │
├─────────────────────────────────────────────────────┤
│ Photo sharing on infected personal USB              │
│ New hire uses personal USB to share photos...       │
│                                                     │
│ Key Takeaways:                                      │
│ - USBs are frequently vectors of malware            │
│ - Advanced malware detection can help limit risk    │
│ - Backups are key, can eliminate need to pay ransom  │
│                                                     │
│ Actions to prevent event:                           │
│ - Purchase and monitor an advanced malware          │
│   detection system on all computers                 │
│ - Clean malware off computer by doing a factory     │
│   reset                                             │
│                                                     │
│ Policy or tech to prevent the worst impacts:        │
│ - Restore member files from backup ✓ action taken   │
│   at 14:30                                          │
│ - Pay $1500 ransomware                              │
│                                          - Collapse │
└─────────────────────────────────────────────────────┘
```

The "Actions to prevent event" section lists all possible `responses` for this injection. A ✓ checkmark + timestamp appears next to any response that was actually taken (found in `responses_made[]`).

The "Policy or tech to prevent worst impacts" section lists mitigation-linked responses (responses where `mitigation_id` is set). A ✓ appears next to ones where the linked mitigation was purchased.

### 3. Routing Change — `Game.jsx`

**File:** `src/components/Game.jsx`

```jsx
// Current:
if (queryParams.isProjectorView || gameState === GameStates.ASSESSMENT) {
  return <Projector />;
}

// Updated:
if (gameState === GameStates.ASSESSMENT) {
  return <AfterActionReview />;
}
if (queryParams.isProjectorView) {
  return <Projector />;
}
```

The Projector view stays available for non-ASSESSMENT projector use. ASSESSMENT now renders the new AAR page.

### 4. Styling — `src/index.scss`

Add AAR-specific styles using the existing Bootstrap variables and Arimo font. No new CSS framework or library needed.

```scss
// Event card header colors
.aar-header--injected    { background-color: #333; color: #fff; }       // black
.aar-header--prevented   { background-color: #007bff; color: #fff; }    // blue (Bootstrap primary)
.aar-header--avoided     { background-color: #28a745; color: #fff; }    // green (Bootstrap success)
.aar-header--not-avoided { background-color: #dc3545; color: #fff; }    // red (Bootstrap danger)
.aar-header--mitigation  { background-color: #fd7e14; color: #fff; }    // orange (Bootstrap warning)

// Connector between cards
.aar-connector {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.75rem 0;
  color: #6c757d;
  font-weight: 600;

  &__line {
    width: 2px;
    height: 20px;
    background: #dee2e6;
  }
}

// Expand/collapse toggle
.aar-card {
  border-radius: 1rem;
  overflow: hidden;
  margin-bottom: 0;
  border: 1px solid #dee2e6;
  transition: box-shadow 0.2s;

  &:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }

  &__expand-toggle {
    cursor: pointer;
    color: #6c757d;
    font-size: 0.875rem;
    &:hover { color: #333; }
  }
}

// Impact badges
.aar-impact {
  font-weight: 700;
  &--negative { color: #dc3545; }
  &--positive { color: #28a745; }
  &--avoided  { color: #6c757d; text-decoration: line-through; }
}

// Action checkmarks
.aar-action-taken {
  color: #28a745;
  &::before { content: '✓ '; font-weight: 700; }
}
```

---

## Data Flow

```
Game finishes → state = ASSESSMENT
  → Game.jsx renders <AfterActionReview />
  → AfterActionReview.jsx calls GET /games/:gameId/aar
  → Backend assembles chains from game_injection + injection + response + game_mitigation + game_log
  → Returns { game, chains[], mitigations[] }
  → Frontend renders AARTimeline with chain cards
  → Each card is collapsed by default, expandable on click
  → No socket connection needed (read-only REST)
```

---

## Event Chain Classification Logic

For each top-level injection (not a followup of another injection):

```
IF injection.prevented AND injection.skipper_mitigation purchased:
  → BLUE card: "EVENT PREVENTED via {mitigation_name}"
  → If injection has followup_injection:
      → "Followup event" connector
      → BLUE follow-up card: "EVENT PREVENTED" + "AVOIDED DAMAGE: {poll_change}%"
        (rendered from static data; follow-up's own delivered/prevented flags are false)
  → Expanded view still shows all actions/mitigations

ELSE IF injection.delivered:
  → BLACK card: "THREAT INJECTED"

  IF injection has followup_injection:
    IF is_response_correct === true:
      → GREEN connector: "Correct response: {RESPONSE_NAME}"
      → Followup card GREEN: "EVENT AVOIDED" + "AVOIDED DAMAGE: {poll_change}%"

    ELSE (incorrect or no response):
      → RED connector: "Incorrect response: {RESPONSE_NAME}" (or "No response")
      → Followup card RED: "FOLLOW UP EVENT" + "POLLS: {poll_change}%"

      IF followup has post-event mitigation taken (from game_log):
        → ORANGE card below: "THREAT MITIGATION" + cost/description

ELSE (not delivered, not prevented — game ended early):
  → GRAY card: "NOT REACHED" (omit or show dimmed)
```

---

## Handling the Client's Specific Scenarios

### Scenario 1: Spearphishing prevented by 2FA purchase
- Injection has `skipper_mitigation` = "2FA for Director"
- `game_mitigation` for that mitigation has `state: true`, `preparation: true`
- **Display:** BLUE parent card: `"07:00 - EVENT PREVENTED via IMPLEMENTING 2FA FOR DIRECTOR"`
- Below the parent: a **"Followup event"** connector, then a second BLUE card for the follow-up: `"25:00 - EVENT PREVENTED"` + `"AVOIDED DAMAGE: -3%"`
- The follow-up's own `delivered` and `prevented` flags are both `false` (it was never triggered); the blue rendering is driven by the parent's `category === 'prevented'` state, not the follow-up's own state
- Expanded view shows all actions/mitigations even though event was prevented

### Scenario 2: USB malware → correct response → followup avoided
- Injection delivered at 12:00, player selects "REFORMAT COMPUTERS" (correct response)
- Followup "Ransomware attack disables GN computers" at 51:00 is prevented
- **Display:** BLACK card → GREEN connector "Correct response: REFORMAT COMPUTERS" → GREEN followup "EVENT AVOIDED" + "AVOIDED DAMAGE: -2%"

### Scenario 3: USB malware → incorrect response → followup triggers → post-event mitigation
- Injection delivered at 12:00, player selects "RESET PASSWORD" (incorrect)
- Followup "Ransomware attack" delivered at 51:00, POLLS: -2%
- Player then pays $1500 ransomware
- **Display:** BLACK card → RED connector "Incorrect response: RESET PASSWORD" → RED followup "FOLLOW UP EVENT" + "POLLS: -2%" → ORANGE card "Data restored due to mitigation" + "-1500 USD"

### Scenario 4: Event prevented by purchase, but also had correct response option
- Per client request: even when prevented by purchase, show that it *could* also have been prevented by a correct response
- Expanded blue card shows both:
  - "Actions to prevent event: Purchase malware detection ✓ 0:00" (purchased at game start)
  - "Actions to prevent event: Clean malware off computer" (would have worked too)

### Scenario 5: Followup shows up only once (under parent)
- Per client request: followup events should NOT appear as separate entries in the timeline
- They only appear as nested cards under their parent event chain

### Scenario 6: Skipper mitigation purchase prevents parent AND renders follow-up as nested BLUE card
- Injection **1005** (_Incoming email — Spearphishing_) has a `skipper_mitigation` (2FA for Director) **and** a `followup_injection` pointing to **1022** (_Strategy leaked_).
- When the skipper mitigation is purchased in the Preparation phase, `startSimulation` marks injection **1005** as `prevented: true`.
- Injection **1022** is never delivered by the simulation — its `game_injection` row stays with `delivered=false, prevented=false`. The follow-up's own state is irrelevant for rendering purposes; what matters is the **parent's category**.
- **Display:**
  ```
  BLUE card (1005) — "EVENT PREVENTED via IMPLEMENT TWO-FACTOR AUTHENTICATION FOR DIRECTOR"
     │
  [Followup event connector]
     │
  BLUE card (1022) — "EVENT PREVENTED" + "AVOIDED DAMAGE: -3%"
  ```
  - `AAREventChain` detects `category === 'prevented' && followup` and renders the connector + `<AARFollowupCard parentPrevented />`.
  - `AARFollowupCard` renders the blue card from the follow-up's static data (`title`, `poll_change`) rather than from its runtime delivery state.
  - Injection **1022** does **not** appear as a separate top-level chain (the backend excludes follow-up IDs from the top-level list; the frontend renders it only as a nested card).
- **Why this matters:** This is the only scenario where a single budget purchase simultaneously prevents a parent injection _and_ its downstream follow-up before the simulation clock starts. It is distinct from TC-4 (correct response prevents follow-up during simulation) because the entire chain is cut at prep time.
- Implementation: `AAREventChain.jsx` (`showPreventedFollowup`), `AARFollowupCard.jsx` (`parentPrevented` prop).
- Covered by: **TC-11** in `CyberSim-UI/e2e/after-action-review.spec.js`.

---

## Implementation Plan

### Phase 1: Backend — AAR Endpoint (CyberSim-Backend)

| # | Task | File(s) | Estimate |
|---|------|---------|----------|
| 1 | Create `src/models/aar.js` with `getAARData()` function | `src/models/aar.js` | New file |
| 2 | Add `GET /games/:gameId/aar` route | `src/app.js` | ~5 lines |
| 3 | Write tests for AAR chain assembly | `tests/aar.test.js` | New file |

### Phase 2: Frontend — AAR Components (CyberSim-UI)

| # | Task | File(s) | Estimate |
|---|------|---------|----------|
| 4 | Create `AfterActionReview.jsx` page component | `src/components/AfterActionReview/AfterActionReview.jsx` | New file |
| 5 | Create `AARTimeline.jsx` | `src/components/AfterActionReview/AARTimeline.jsx` | New file |
| 6 | Create `AAREventChain.jsx` (parent + connector + followup layout) | `src/components/AfterActionReview/AAREventChain.jsx` | New file |
| 7 | Create `AAREventCard.jsx` (collapsed/expanded card) | `src/components/AfterActionReview/AAREventCard.jsx` | New file |
| 8 | Create `AARResponseIndicator.jsx` (correct/incorrect badge) | `src/components/AfterActionReview/AARResponseIndicator.jsx` | New file |
| 9 | Create `AARFollowupCard.jsx` | `src/components/AfterActionReview/AARFollowupCard.jsx` | New file |
| 10 | Create `AARMitigationBadge.jsx` | `src/components/AfterActionReview/AARMitigationBadge.jsx` | New file |
| 11 | Create `AARExpandedDetails.jsx` (actions/policy lists) | `src/components/AfterActionReview/AARExpandedDetails.jsx` | New file |
| 12 | Add AAR styles to `src/index.scss` | `src/index.scss` | Append |
| 13 | Update `Game.jsx` routing for ASSESSMENT state | `src/components/Game.jsx` | ~5 lines |

### Phase 3: Polish & QA

| # | Task |
|---|------|
| 14 | Test with a game that has prevented events (blue cards) |
| 15 | Test with correct responses leading to avoided followups (green) |
| 16 | Test with incorrect responses leading to followup events (red) |
| 17 | Test with post-event mitigations (orange) |
| 18 | Test expand/collapse behavior |
| 19 | Test with a game where all injections were prevented |
| 20 | Test with a game that ended early (some injections never reached) |
| 21 | Verify the Projector view still works during SIMULATION state |

---

## Checklist

- [ ] `src/models/aar.js` — AAR data assembly model
- [ ] `src/app.js` — AAR REST endpoint
- [ ] `tests/aar.test.js` — Backend tests for chain building
- [ ] `AfterActionReview.jsx` — Page component with data fetching
- [ ] `AARTimeline.jsx` — Ordered timeline rendering
- [ ] `AAREventChain.jsx` — Event chain layout
- [ ] `AAREventCard.jsx` — Collapsible event card
- [ ] `AARResponseIndicator.jsx` — Response badge
- [ ] `AARFollowupCard.jsx` — Follow-up card
- [ ] `AARMitigationBadge.jsx` — Mitigation indicator
- [ ] `AARExpandedDetails.jsx` — Expanded detail sections
- [ ] `src/index.scss` — AAR styles
- [ ] `Game.jsx` — Route ASSESSMENT to AAR page
- [ ] Manual QA across all event chain scenarios
- [ ] Verify no new dependencies added
