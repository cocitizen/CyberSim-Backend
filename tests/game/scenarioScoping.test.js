/**
 * Cross-scenario scoping regression tests.
 *
 * After the composite-PK migrations, a static row's Airtable id is unique only
 * *within* a scenario — two scenarios can share the same id (e.g. I1, C4, A1,
 * M1). Every game-mutation lookup must therefore filter by the game's
 * scenario_id, or it can read another scenario's copy of the row and apply the
 * wrong gameplay values.
 *
 * These tests run a game in the tnr scenario (seeded second, scenario_id 2)
 * while cso (scenario_id 1) holds colliding ids with deliberately different
 * values. If a lookup is not scenario-scoped, it picks up cso's row and these
 * assertions fail.
 */
const db = require('../../src/models/db');
const resetAllTables = require('../resetAllTables');
const seedTestData = require('../seedTestData');
const {
  deliverGameInjection,
  performCurveball,
  performAction,
  changeMitigation,
  makeResponses,
} = require('../../src/models/game');

const TNR_SCENARIO_ID = 2;
const GAME_ID = 'TnrScopeGame';
const START_BUDGET = 10000;
const START_POLL = 55;

// A game living in the tnr scenario, in SIMULATION with a known budget/poll.
const tnrGame = {
  id: GAME_ID,
  scenario_id: TNR_SCENARIO_ID,
  state: 'SIMULATION',
  poll: START_POLL,
  budget: START_BUDGET,
  paused: false,
  millis_taken_before_started: 0,
};

describe('Cross-scenario scoping (game in tnr, colliding ids in cso)', () => {
  beforeEach(async () => {
    // Re-seed static data so this suite is independent of test ordering —
    // other suites (e.g. scenario import) mutate or replace static content.
    await resetAllTables();
    await seedTestData(db);
    await db('game').insert({ ...tnrGame, started_at: db.fn.now() });
    await db('game_injection').insert([
      {
        game_id: GAME_ID,
        injection_id: 'I1',
        delivered: false,
        prevented: false,
      },
      {
        game_id: GAME_ID,
        injection_id: 'I2',
        delivered: false,
        prevented: false,
      },
      {
        game_id: GAME_ID,
        injection_id: 'I3',
        delivered: false,
        prevented: false,
      },
    ]);
    await db('game_system').insert([
      { game_id: GAME_ID, system_id: 'S1', state: true },
      { game_id: GAME_ID, system_id: 'S2', state: true },
    ]);
    await db('game_mitigation').insert([
      {
        game_id: GAME_ID,
        mitigation_id: 'M1',
        state: false,
        preparation: false,
      },
      {
        game_id: GAME_ID,
        mitigation_id: 'M2',
        state: false,
        preparation: false,
      },
    ]);
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('deliverGameInjection applies the tnr injection, not cso', async () => {
    // tnr I1: poll -5, budget -50, disables S2.  cso I1: poll -0.5, budget -500, disables S1.
    const game = await deliverGameInjection({
      gameId: GAME_ID,
      injectionId: 'I1',
    });

    expect(game.budget).toBe(START_BUDGET - 50);
    expect(game.poll).toBe(START_POLL - 5);

    const systems = await db('game_system').where({ game_id: GAME_ID });
    const s2 = systems.find((s) => s.system_id === 'S2');
    const s1 = systems.find((s) => s.system_id === 'S1');
    expect(s2.state).toBe(false); // tnr disables S2
    expect(s1.state).toBe(true); // cso would have disabled S1
  });

  test('performCurveball applies the tnr curveball, not cso', async () => {
    // tnr C4: budget -100, poll -2.  cso C4: budget -1000, poll -10.
    const game = await performCurveball({ gameId: GAME_ID, curveballId: 'C4' });

    expect(game.budget).toBe(START_BUDGET - 100);
    expect(game.poll).toBe(START_POLL - 2);
  });

  test('performAction applies the tnr action cost/poll, not cso', async () => {
    // tnr A1: cost 2000, poll +9.  cso A1: cost 1000, poll +5.
    const game = await performAction({ gameId: GAME_ID, actionId: 'A1' });

    expect(game.budget).toBe(START_BUDGET - 2000);
    expect(game.poll).toBe(START_POLL + 9);
  });

  test('changeMitigation charges the tnr cost and skips only tnr injections', async () => {
    // tnr M1 cost 2000 (cso M1 cost 1000).
    // tnr injection with skipper_mitigation M1 is I3; cso's is I1.
    const game = await changeMitigation({
      gameId: GAME_ID,
      mitigationId: 'M1',
      mitigationValue: true,
    });

    expect(game.budget).toBe(START_BUDGET - 2000);

    const gi = await db('game_injection').where({ game_id: GAME_ID });
    const i3 = gi.find((r) => r.injection_id === 'I3');
    const i1 = gi.find((r) => r.injection_id === 'I1');
    expect(i3.prevented).toBe(true); // tnr I3 has skipper M1
    expect(i1.prevented).toBe(false); // cso I1 has skipper M1 — must NOT leak in
  });

  test('makeResponses prevents the tnr followup injection, not cso', async () => {
    // tnr I1 → followup I3.  cso I1 → followup I2.
    await makeResponses({ gameId: GAME_ID, injectionId: 'I1' });

    const gi = await db('game_injection').where({ game_id: GAME_ID });
    const i3 = gi.find((r) => r.injection_id === 'I3');
    const i2 = gi.find((r) => r.injection_id === 'I2');
    expect(i3.prevented).toBe(true); // tnr followup
    expect(i2.prevented).toBe(false); // cso followup — must NOT leak in
  });
});
