const db = require('../src/models/db');
const { getScenarioBySlug } = require('../src/models/scenario');
const { createGame } = require('../src/models/game');
const resetGameTables = require('./resetGameTables');

// Helper to insert a minimal second scenario with one system,
// one mitigation, and one injection — just enough to verify isolation.
async function seedSecondScenario(knex) {
  const [scenario] = await knex('scenario')
    .insert({ slug: 'campaign', name: 'Campaign Scenario' })
    .returning('*');

  await knex('system').insert({
    id: 'CAMP-S1',
    name: 'Campaign HQ system',
    description: '',
    type: 'hq',
    scenario_id: scenario.id,
  });

  await knex('mitigation').insert({
    id: 'CAMP-M1',
    description: 'Campaign mitigation',
    category: 'Operation',
    cost: 500,
    is_hq: true,
    is_local: false,
    scenario_id: scenario.id,
  });

  await knex('injection').insert({
    id: 'CAMP-I1',
    title: 'Campaign Injection',
    description: 'A campaign-specific injection',
    trigger_time: 60000,
    location: 'hq',
    type: 'Table',
    recipient_role: 'Campaign role',
    asset_code: 'C1',
    poll_change: -1,
    systems_to_disable: [],
    skipper_mitigation: null,
    recommendations: null,
    followup_injection: null,
    scenario_id: scenario.id,
  });

  return scenario;
}

// Single top-level teardown. Each describe block having its own db.destroy()
// would close the connection pool mid-suite, causing "Unable to acquire a
// connection" errors in subsequent describe blocks.
afterAll(async () => {
  await db.destroy();
});

describe('getScenarioBySlug', () => {
  test('returns the scenario row for a valid slug', async () => {
    const scenario = await getScenarioBySlug('cso');
    expect(scenario).toMatchObject({ slug: 'cso', name: 'CSO Scenario' });
  });

  test('throws a descriptive error for an unknown slug', async () => {
    const err = await getScenarioBySlug('does-not-exist').catch((e) => e);
    expect(err.message).toBe('Scenario not found: "does-not-exist"');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('SCENARIO_NOT_FOUND');
  });
});

describe('createGame — scenario isolation', () => {
  beforeEach(async () => {
    await resetGameTables();
    await seedSecondScenario(db);
  });

  // Tear the 'campaign' scenario down after each test so it never leaks past
  // this suite. (Runs before the file-level afterAll that closes the pool.)
  // Clear games FIRST: game.scenario_id has a RESTRICT FK to scenario, so the
  // scenario row can't be deleted while a game still references it.
  afterEach(async () => {
    await resetGameTables();
    await db('injection').where({ id: 'CAMP-I1' }).del();
    await db('mitigation').where({ id: 'CAMP-M1' }).del();
    await db('system').where({ id: 'CAMP-S1' }).del();
    await db('scenario').where({ slug: 'campaign' }).del();
  });

  test('stores the correct scenario_id on the game row', async () => {
    await createGame('GameA', 6000, 55, 'cso');

    const gameRow = await db('game').where({ id: 'GameA' }).first();
    const csoScenario = await getScenarioBySlug('cso');

    expect(gameRow.scenario_id).toBe(csoScenario.id);
  });

  test('defaults to cso when no scenarioSlug is provided', async () => {
    await createGame('GameB');

    const gameRow = await db('game').where({ id: 'GameB' }).first();
    const csoScenario = await getScenarioBySlug('cso');

    expect(gameRow.scenario_id).toBe(csoScenario.id);
  });

  test('only clones static data belonging to the requested scenario', async () => {
    await createGame('GameCSO', 6000, 55, 'cso');
    await createGame('GameCampaign', 6000, 55, 'campaign');

    // CSO game should have CSO systems (S1, S2) but not the campaign system
    const csoSystems = await db('game_system').where({ game_id: 'GameCSO' });
    const csoSystemIds = csoSystems.map((r) => r.system_id);
    expect(csoSystemIds).toContain('S1');
    expect(csoSystemIds).toContain('S2');
    expect(csoSystemIds).not.toContain('CAMP-S1');

    // Campaign game should have only the campaign system
    const campaignSystems = await db('game_system').where({
      game_id: 'GameCampaign',
    });
    const campaignSystemIds = campaignSystems.map((r) => r.system_id);
    expect(campaignSystemIds).toContain('CAMP-S1');
    expect(campaignSystemIds).not.toContain('S1');
    expect(campaignSystemIds).not.toContain('S2');

    // Same isolation check for injections
    const csoInjections = await db('game_injection').where({
      game_id: 'GameCSO',
    });
    const csoInjectionIds = csoInjections.map((r) => r.injection_id);
    expect(csoInjectionIds).not.toContain('CAMP-I1');

    const campaignInjections = await db('game_injection').where({
      game_id: 'GameCampaign',
    });
    const campaignInjectionIds = campaignInjections.map((r) => r.injection_id);
    expect(campaignInjectionIds).toContain('CAMP-I1');
    expect(campaignInjectionIds).not.toContain('I1');
  });

  test('throws for an unknown scenario slug', async () => {
    await expect(
      createGame('GameX', 6000, 55, 'no-such-scenario'),
    ).rejects.toThrow('Scenario not found: "no-such-scenario"');
  });
});
