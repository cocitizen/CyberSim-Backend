const db = require('../src/models/db');
const { getInjectionsByScenarioId } = require('../src/models/injection');
const { staticInjections } = require('./testData');

const resetAllTables = require('./resetAllTables');
const seedTestData = require('./seedTestData');

// cso is seeded first (scenario_id 1), tnr second (scenario_id 2).
const CSO_SCENARIO_ID = 1;
const TNR_SCENARIO_ID = 2;

describe('Get Injections', () => {
  beforeEach(async () => {
    await resetAllTables();
    await seedTestData(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('returns the cso scenario injections with responses', async () => {
    const injectionsFromDb = await getInjectionsByScenarioId(CSO_SCENARIO_ID);
    expect(injectionsFromDb).toMatchObject(staticInjections);
  });

  test('is scoped per scenario: tnr reuses the same ids with its own values', async () => {
    const tnrInjections = await getInjectionsByScenarioId(TNR_SCENARIO_ID);

    // Same Airtable ids as cso...
    expect(tnrInjections.map((i) => i.id).sort()).toEqual(['I1', 'I2', 'I3']);

    // ...but the tnr copy of I1 carries its own gameplay values, not cso's.
    const tnrI1 = tnrInjections.find((i) => i.id === 'I1');
    expect(tnrI1.budget_change).toBe(-50); // cso I1 is -500
    expect(tnrI1.poll_change).toBe(-5); // cso I1 is -0.5
  });
});
