const db = require('../src/models/db');
const { getActionsByScenarioId } = require('../src/models/action');
const { staticActions } = require('./testData');

// cso is seeded first (scenario_id 1), tnr second (scenario_id 2).
const CSO_SCENARIO_ID = 1;
const TNR_SCENARIO_ID = 2;

describe('Get Actions', () => {
  afterAll(async () => {
    await db.destroy();
  });

  test('action table should return with role names', async () => {
    const actionsFromDb = await getActionsByScenarioId(CSO_SCENARIO_ID);
    expect(actionsFromDb).toMatchObject(staticActions);
  });

  test('is scoped per scenario: tnr reuses the same ids with its own values', async () => {
    const tnrActions = await getActionsByScenarioId(TNR_SCENARIO_ID);

    expect(tnrActions.map((a) => a.id).sort()).toEqual(['A1', 'A2']);

    // tnr A1 carries its own cost/poll, not cso's (cso A1: cost 1000, poll +5).
    const tnrA1 = tnrActions.find((a) => a.id === 'A1');
    expect(tnrA1.cost).toBe(2000);
    expect(tnrA1.poll_increase).toBe(9);
  });
});
