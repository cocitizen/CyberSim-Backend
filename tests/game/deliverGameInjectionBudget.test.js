const db = require('../../src/models/db');
const resetGameTables = require('../resetGameTables');
const { deliverGameInjection } = require('../../src/models/game');
const { dummyGame, dummyGameInjections, dummyGameSystems } = require('../testData');

const gameId = dummyGame.id;
// I1 has budget_change: -500 (seeded in seedTestData)
const injectionWithBudgetChange = dummyGameInjections.find(
  (inj) => inj.injection_id === 'I1',
);
// I3 has no budget_change (null)
const injectionWithoutBudgetChange = dummyGameInjections.find(
  (inj) => inj.injection_id === 'I3',
);

describe('Deliver Game Injection - budget_change', () => {
  beforeEach(async () => {
    await resetGameTables();
    await db('game').insert({
      ...dummyGame,
      started_at: db.fn.now(),
      paused: false,
    });
    await db('game_injection').insert(dummyGameInjections);
    await db('game_system').insert(dummyGameSystems);
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('should decrease budget by injection budget_change', async () => {
    const { budget_change: budgetChange } = await db('injection')
      .select('budget_change')
      .where({ id: injectionWithBudgetChange.injection_id })
      .first();

    const { budget: budgetBefore } = await db('game')
      .select('budget')
      .where({ id: gameId })
      .first();

    const { budget: budgetAfter } = await deliverGameInjection({
      gameId,
      injectionId: injectionWithBudgetChange.injection_id,
    });

    expect(budgetAfter).toBe(Math.max(0, budgetBefore + budgetChange));
  });

  test('should not reduce budget below 0', async () => {
    // budget_change on I1 is -500; set budget to 100 so it would go negative
    await db('game').where({ id: gameId }).update({ budget: 100 });

    const { budget: budgetAfter } = await deliverGameInjection({
      gameId,
      injectionId: injectionWithBudgetChange.injection_id,
    });

    expect(budgetAfter).toBe(0);
  });

  test('should not change budget when budget_change is null', async () => {
    const { budget: budgetBefore } = await db('game')
      .select('budget')
      .where({ id: gameId })
      .first();

    await deliverGameInjection({
      gameId,
      injectionId: injectionWithoutBudgetChange.injection_id,
    });

    const { budget: budgetAfter } = await db('game')
      .select('budget')
      .where({ id: gameId })
      .first();

    expect(budgetAfter).toBe(budgetBefore);
  });
});
