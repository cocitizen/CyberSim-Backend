/**
 * Game domain model for creating, loading, and mutating runtime game state.
 *
 * What it does:
 * - Creates scenario-specific games and initializes runtime game tables
 * - Applies gameplay actions such as mitigations, responses, actions, and
 *   curveballs
 * - Returns fully assembled game state for the socket/game flow
 *
 * Important notes:
 * - Games are scenario-aware at creation time via scenarioSlug.
 * - After creation, most operations work from gameId because the game already
 *   carries its scenario_id.
 * - This file contains game rules and side effects, not just plain table reads.
 */
const db = require('./db');
const { getResponsesById } = require('./response');
const { getScenarioBySlug } = require('./scenario');
const logger = require('../logger');
const GameStates = require('../constants/GameStates');
const { getTimeTaken } = require('../util');

const ERR_NOT_ENOUGH_BUDGET = 'Not enough budget';
const ERR_RESPONSE_NOT_ALLOWED = 'Response not allowed';
const ERR_SYSTEMS_NOT_AVAILABLE =
  'The required systems for this action are not available.';
const ERR_CANNOT_START_FINALIZED_GAME = 'Cannot start finalized game';

const getGame = (id) =>
  db('game')
    .select(
      'game.id',
      'game.scenario_id',
      'game.state',
      'game.poll',
      'game.budget',
      'game.started_at',
      'game.paused',
      'game.millis_taken_before_started',
      'i.injections',
      'm.mitigations',
      's.systems',
      'l.logs',
    )
    .where({ 'game.id': id })
    .joinRaw(
      `LEFT JOIN (SELECT gm.game_id, array_agg(to_json(gm)) AS mitigations FROM game_mitigation gm GROUP BY gm.game_id) m ON m.game_id = game.id`,
    )
    .joinRaw(
      `LEFT JOIN (SELECT gs.game_id, array_agg(to_json(gs)) AS systems FROM game_system gs GROUP BY gs.game_id) s ON s.game_id = game.id`,
    )
    .joinRaw(
      `LEFT JOIN (SELECT gi.game_id, array_agg(to_json(gi)) AS injections FROM game_injection gi GROUP BY gi.game_id) i ON i.game_id = game.id`,
    )
    .joinRaw(
      `LEFT JOIN (SELECT gl.game_id, array_agg(to_json(gl)) AS logs FROM game_log gl GROUP BY gl.game_id) l ON l.game_id = game.id`,
    )
    .first();

const createGame = async (
  id,
  initialBudget = 6000,
  initialPollPercentage = 55,
  scenarioSlug = 'cso',
) => {
  const scenario = await getScenarioBySlug(scenarioSlug);

  await db('game').insert(
    {
      id,
      budget: initialBudget,
      poll: initialPollPercentage,
      scenario_id: scenario.id,
    },
    ['id'],
  );

  const systems = await db('system')
    .select('id')
    .where({ scenario_id: scenario.id })
    .orderBy('id');

  await db('game_system').insert(
    systems.map(({ id: systemId }) => ({
      game_id: id,
      system_id: systemId,
      state: true,
    })),
  );

  const mitigations = await db('mitigation')
    .select('id')
    .where({ scenario_id: scenario.id })
    .orderBy('id');

  await db('game_mitigation').insert(
    mitigations.map(({ id: mitigationId }) => ({
      game_id: id,
      mitigation_id: mitigationId,
      state: false,
    })),
  );

  const injections = await db('injection')
    .select('id')
    .where({ scenario_id: scenario.id })
    .orderBy('id');

  await db('game_injection').insert(
    injections.map(({ id: injectionId }) => ({
      game_id: id,
      injection_id: injectionId,
    })),
  );
  return getGame(id);
};

const changeMitigation = async ({ mitigationId, mitigationValue, gameId }) => {
  try {
    const game = await db('game')
      .select(
        'budget',
        'state',
        'started_at as startedAt',
        'paused',
        'millis_taken_before_started as millisTakenBeforeStarted',
      )
      .where({ id: gameId })
      .first();

    const mitigationRow = await db('game_mitigation')
      .select('state', 'id')
      .where({
        game_id: gameId,
        mitigation_id: mitigationId,
      })
      .first();

    const gameMitigationValue = mitigationRow.state;

    if (gameMitigationValue !== mitigationValue) {
      const mitigation = await db('mitigation')
        .select('cost')
        .where({ id: mitigationId })
        .first();

      const cost = mitigation?.cost;

      // --- Budget handling ---
      if (cost != null && cost > 0) {
        if (mitigationValue && game.budget < cost) {
          throw new Error(ERR_NOT_ENOUGH_BUDGET);
        }

        const newBudget = mitigationValue
          ? game.budget - cost
          : game.budget + cost;

        await db('game')
          .where({ id: gameId })
          .update({ budget: Math.max(0, newBudget) });
      }

      // --- Update mitigation ---
      const updateFields = { state: mitigationValue };

      if (game.state === GameStates.PREPARATION) {
        updateFields.preparation = mitigationValue;
      }

      await db('game_mitigation')
        .where({
          game_id: gameId,
          mitigation_id: mitigationId,
        })
        .update(updateFields);

      // --- If not in preparation, log + prevent injections ---
      if (game.state !== GameStates.PREPARATION) {
        const timeTaken = getTimeTaken(game);

        await db('game_injection')
          .where({ game_id: gameId, delivered: false })
          .whereIn('injection_id', function findInjectionsToSkip() {
            this.select('id')
              .from('injection')
              .where({ skipper_mitigation: mitigationId });
          })
          .update({ prevented: true, prevented_at: timeTaken });

        await db('game_log').insert({
          game_id: gameId,
          game_timer: timeTaken,
          type: 'Budget Item Purchase',
          mitigation_id: mitigationId,
        });
      }
    }
  } catch (error) {
    logger.error('changeMitigation ERROR: %s', error?.stack || error);
    logger.error('changeMitigation context: %j', {
      gameId,
      mitigationId,
      mitigationValue,
    });

    if (error.message === ERR_NOT_ENOUGH_BUDGET) {
      throw error;
    }

    throw new Error('Server error on change mitigation');
  }

  return getGame(gameId);
};

const startSimulation = async (gameId) => {
  try {
    const { state, millisTakenBeforeStarted } = await db('game')
      .select(
        'state',
        'millis_taken_before_started as millisTakenBeforeStarted',
      )
      .where({ id: gameId })
      .first();
    if (state === GameStates.ASSESSMENT) {
      throw new Error(ERR_CANNOT_START_FINALIZED_GAME);
    }
    await db('game')
      .where({ id: gameId })
      .update({
        started_at: db.fn.now(),
        paused: false,
        ...(state === GameStates.PREPARATION
          ? { state: GameStates.SIMULATION, budget: 0 }
          : {}),
      });
    if (state === GameStates.PREPARATION) {
      const gameMitigations = await db('game_mitigation')
        .select('game_mitigation.mitigation_id as gameMitigationId')
        .where({
          game_id: gameId,
          state: true,
        });
      const mitigationClauses = gameMitigations.map(
        ({ gameMitigationId }) => gameMitigationId,
      );
      await db('game_injection')
        .where({
          game_id: gameId,
          delivered: false,
        })
        .whereIn('injection_id', function findInjectionsToSkip() {
          this.select('id')
            .from('injection')
            .whereIn('skipper_mitigation', mitigationClauses);
        })
        .update({ prevented: true, prevented_at: millisTakenBeforeStarted });
    }
    await db('game_log').insert({
      game_id: gameId,
      game_timer: millisTakenBeforeStarted,
      type: 'Game State Changed',
      description:
        state === GameStates.PREPARATION
          ? 'Simulation Started'
          : 'Timer Started',
    });
  } catch (error) {
    if (error.message === ERR_CANNOT_START_FINALIZED_GAME) {
      throw error;
    }
    logger.error('startSimulation ERROR: %s', error?.stack || error);
    throw new Error('Server error on start simulation');
  }
  return getGame(gameId);
};

const pauseSimulation = async ({ gameId, finishSimulation = false }) => {
  try {
    const { millisTakenBeforeStarted, startedAt, paused } = await db('game')
      .select(
        'millis_taken_before_started as millisTakenBeforeStarted',
        'started_at as startedAt',
        'paused',
      )
      .where({ id: gameId, state: GameStates.SIMULATION })
      .first();
    const newMillisTakenBeforeStarted =
      millisTakenBeforeStarted + (Date.now() - new Date(startedAt).getTime());
    await db('game')
      .where({ id: gameId, state: GameStates.SIMULATION })
      .update({
        paused: true,
        ...(!paused
          ? { millis_taken_before_started: newMillisTakenBeforeStarted }
          : {}),
        ...(finishSimulation ? { state: GameStates.ASSESSMENT } : {}),
      });
    await db('game_log').insert({
      game_id: gameId,
      ...(!paused
        ? { game_timer: newMillisTakenBeforeStarted }
        : { game_timer: millisTakenBeforeStarted }),
      type: 'Game State Changed',
      description: finishSimulation ? 'Game Finalized' : 'Timer Stopped',
    });
  } catch (error) {
    if (finishSimulation) {
      logger.error('finishSimulation ERROR: %s', error?.stack || error);
    } else {
      logger.error('pauseSimulation ERROR: %s', error?.stack || error);
    }
    throw new Error('Server error on pause simulation');
  }
  return getGame(gameId);
};

// Use for respond to injection and restore system
const makeResponses = async ({
  responseIds,
  gameId,
  injectionId,
  customResponse,
}) => {
  try {
    const game = await db('game')
      .select(
        'game.id',
        'game.budget',
        'game.started_at as startedAt',
        'game.paused',
        'game.millis_taken_before_started as millisTakenBeforeStarted',
        'm.mitigations',
      )
      .where({ 'game.id': gameId })
      .joinRaw(
        `LEFT JOIN (SELECT gm.game_id, array_agg(to_json(gm)) AS mitigations FROM game_mitigation gm GROUP BY gm.game_id) m ON m.game_id = game.id`,
      )
      .first();
    const timeTaken = getTimeTaken(game);
    if (responseIds?.length) {
      const responses = await getResponsesById(responseIds);
      // Which mitigations are active (purchased) in this game?
      const purchased = new Set(
        (game.mitigations || [])
          .filter((m) => m.state)
          .map((m) => m.mitigation_id),
      );

      // Pull applicability flags (hq/local) for any required mitigations
      const requiredIds = [
        ...new Set(responses.map((r) => r.required_mitigation).filter(Boolean)),
      ];

      const applicabilityRows = requiredIds.length
        ? await db('mitigation')
            .select('id', 'is_hq', 'is_local')
            .whereIn('id', requiredIds)
        : [];

      const applicability = applicabilityRows.reduce((acc, m) => {
        acc[m.id] = { hq: !!m.is_hq, local: !!m.is_local };
        return acc;
      }, {});

      // CHECK REQUIRED MITIGATION
      // CHECK REQUIRED MITIGATION
      responses.forEach((response) => {
        const requiredMitigationType = response.required_mitigation_type;
        const requiredMitigationId = response.required_mitigation;

        // If there is no requirement, nothing to validate for this response.
        if (!requiredMitigationId) {
          return;
        }

        // Rule 1: required mitigation must be purchased (enabled) in this game
        if (!purchased.has(requiredMitigationId)) {
          throw new Error(ERR_RESPONSE_NOT_ALLOWED);
        }

        // Rule 2: required mitigation must be applicable to the required "type"
        // based on mitigation.is_hq / mitigation.is_local flags.
        const flags = applicability[requiredMitigationId] || {
          hq: false,
          local: false,
        };

        if (requiredMitigationType === 'hq' && !flags.hq) {
          throw new Error(ERR_RESPONSE_NOT_ALLOWED);
        }

        if (requiredMitigationType === 'local' && !flags.local) {
          throw new Error(ERR_RESPONSE_NOT_ALLOWED);
        }

        if (requiredMitigationType === 'party' && !(flags.hq && flags.local)) {
          throw new Error(ERR_RESPONSE_NOT_ALLOWED);
        }
      });
      // CHECK AVAILABLE BUDGET
      const cost = responses.reduce((acc, r) => acc + (Number(r.cost) || 0), 0);

      if (game.budget < cost) {
        throw new Error(ERR_NOT_ENOUGH_BUDGET);
      }
      // ALLOCATE BUDGET
      if (cost > 0) {
        await db('game')
          .where({ id: gameId })
          .update({ budget: Math.max(0, game.budget - cost) });
      }
      // SET MITIGATIONS
      await Promise.all(
        responses.map(async ({ mitigation_id: mitigationId }) => {
          if (mitigationId) {
            await db('game_mitigation')
              .where({
                game_id: gameId,
                mitigation_id: mitigationId,
              })
              .update({ state: true });
            await db('game_injection')
              .where({ game_id: gameId, delivered: false, prevented: false })
              .whereIn('injection_id', function findInjectionsToSkip() {
                this.select('id').from('injection').where({
                  skipper_mitigation: mitigationId,
                });
              })
              .update({ prevented: true, prevented_at: timeTaken });
          }
        }),
      );
      // SET SYSTEMS
      const systemIdsToRestore = responses.reduce(
        (acc, { systems_to_restore: systemsToRestore }) => {
          if (systemsToRestore && systemsToRestore.length) {
            return [...acc, ...systemsToRestore];
          }
          return acc;
        },
        [],
      );
      if (systemIdsToRestore.length !== 0) {
        await db('game_system')
          .where({ game_id: gameId })
          .whereIn('system_id', systemIdsToRestore)
          .update({ state: true });
      }
    }
    // SET GAME INJECTION
    if (injectionId) {
      const { followupInjection } = await db('injection')
        .select('followup_injection as followupInjection')
        .where('id', injectionId)
        .first();
      if (followupInjection) {
        await db('game_injection')
          .where({
            game_id: gameId,
            delivered: false,
            injection_id: followupInjection,
          })
          .update({
            prevented: true,
            prevented_at: timeTaken,
          });
      }
      await db('game_injection')
        .where({
          game_id: gameId,
          injection_id: injectionId,
        })
        .update({
          ...(responseIds?.length
            ? { predefined_responses_made: responseIds }
            : {}),
          is_response_correct: true,
          response_made_at: timeTaken,
          ...(customResponse ? { custom_response: customResponse } : {}),
        });
    } else {
      await db('game_log').insert({
        game_id: gameId,
        game_timer: timeTaken,
        type: 'System Restore Action',
        response_id: responseIds[0],
      });
    }
    return getGame(gameId);
  } catch (error) {
    logger.error('makeResponses ERROR: %s', error?.stack || error);
    logger.error('makeResponses context: %j', {
      gameId,
      injectionId,
      responseIds,
      hasCustomResponse: !!customResponse,
    });
    if (
      error.message === ERR_NOT_ENOUGH_BUDGET ||
      error.message === ERR_RESPONSE_NOT_ALLOWED
    ) {
      throw error;
    }
    const e = new Error(`Server error in makeResponses: ${error.message}`);
    e.cause = error;
    e.meta = { gameId, injectionId, responseIds }; // optional
    throw e;
  }
};

const deliverGameInjection = async ({ gameId, injectionId }) => {
  try {
    const game = await db('game')
      .select(
        'started_at as startedAt',
        'paused',
        'millis_taken_before_started as millisTakenBeforeStarted',
        'poll',
        'budget',
      )
      .where({ id: gameId })
      .first();
    const { systemsToDisable, pollChange, budgetChange } = await db('injection')
      .select(
        'systems_to_disable as systemsToDisable',
        'poll_change as pollChange',
        'budget_change as budgetChange',
      )
      .where({ id: injectionId })
      .first();
    if (systemsToDisable?.length) {
      await db('game_system')
        .where({ game_id: gameId })
        .whereIn('system_id', systemsToDisable)
        .update({ state: false });
    }
    if (pollChange || budgetChange) {
      const update = {};
      if (pollChange) {
        update.poll = Math.max(0, Math.min(game.poll + pollChange, 200));
      }
      if (budgetChange) {
        update.budget = Math.max(0, game.budget + budgetChange);
      }
      await db('game').where({ id: gameId }).update(update);
    }
    await db('game_injection')
      .where({
        game_id: gameId,
        injection_id: injectionId,
      })
      .update({ delivered: true, delivered_at: getTimeTaken(game) });
  } catch (error) {
    logger.error('deliverGameInjection ERROR: %s', error?.stack || error);
    throw new Error('Server error on changing games injection deliverance');
  }
  return getGame(gameId);
};

const makeNonCorrectInjectionResponse = async ({
  gameId,
  injectionId,
  customResponse,
}) => {
  try {
    const game = await db('game')
      .select(
        'started_at as startedAt',
        'paused',
        'millis_taken_before_started as millisTakenBeforeStarted',
      )
      .where({ id: gameId })
      .first();
    await db('game_injection')
      .where({
        game_id: gameId,
        injection_id: injectionId,
      })
      .update({
        response_made_at: getTimeTaken(game),
        ...(customResponse ? { custom_response: customResponse } : {}),
      });
  } catch (error) {
    logger.error(
      'makeNonCorrectInjectionResponse ERROR: %s',
      error?.stack || error,
    );
    throw new Error('Server error on making non correct injection response');
  }
  return getGame(gameId);
};

const performAction = async ({ gameId, actionId }) => {
  try {
    const game = await db('game')
      .select(
        'budget',
        'poll',
        'started_at as startedAt',
        'paused',
        'millis_taken_before_started as millisTakenBeforeStarted',
      )
      .where({ id: gameId })
      .first();

    const { cost, budgetIncrease, pollIncrease, requiredSystems } = await db(
      'action',
    )
      .select(
        'cost',
        'budget_increase as budgetIncrease',
        'poll_increase as pollIncrease',
        'required_systems as requiredSystems',
      )
      .where({ id: actionId })
      .first();

    if (game.budget < cost) {
      throw new Error(ERR_NOT_ENOUGH_BUDGET);
    }

    const unavailableSystems = await db('game_system')
      .select()
      .where({ game_id: gameId, state: false })
      .whereIn('system_id', requiredSystems);

    if (unavailableSystems.length > 0) {
      throw new Error(ERR_SYSTEMS_NOT_AVAILABLE);
    }

    await db('game')
      .where({ id: gameId })
      .update({
        budget: Math.max(0, game.budget - cost + budgetIncrease),
        poll: Math.max(0, Math.min(game.poll + pollIncrease, 200)),
      });
    await db('game_log').insert({
      game_id: gameId,
      game_timer: getTimeTaken(game),
      type: 'Campaign Action',
      action_id: actionId,
    });
  } catch (error) {
    logger.error('performAction ERROR: %s', error?.stack || error);
    switch (error.message) {
      case 'Not enough budget':
        throw error;
      case ERR_SYSTEMS_NOT_AVAILABLE:
        throw error;
      default:
        throw new Error('Server error on performing action');
    }
  }
  return getGame(gameId);
};

const performCurveball = async ({ gameId, curveballId }) => {
  try {
    const game = await db('game')
      .select(
        'budget',
        'poll',
        'started_at as startedAt',
        'paused',
        'millis_taken_before_started as millisTakenBeforeStarted',
      )
      .where({ id: gameId })
      .first();

    const { budgetChange, pollChange, loseAllBudget } = await db('curveball')
      .select(
        'lose_all_budget as loseAllBudget',
        'budget_change as budgetChange',
        'poll_change as pollChange',
      )
      .where({ id: curveballId })
      .first();

    await db('game')
      .where({ id: gameId })
      .update({
        budget: loseAllBudget ? 0 : Math.max(0, game.budget + budgetChange),
        poll: Math.min(Math.max(game.poll + pollChange, 0), 200),
      });

    await db('game_log').insert({
      game_id: gameId,
      game_timer: getTimeTaken(game),
      type: 'Curveball Event',
      curveball_id: curveballId,
    });
  } catch (error) {
    logger.error('performCurveball ERROR: %s', error?.stack || error);
    throw new Error('Server error on performing action');
  }
  return getGame(gameId);
};

// List games joined with their scenario, optionally filtered by scenarioSlug.
const listGames = async ({ scenarioSlug } = {}) => {
  let query = db('game')
    .join('scenario', 'game.scenario_id', 'scenario.id')
    .select(
      'game.id',
      'game.state',
      'game.poll',
      'game.budget',
      'game.started_at',
      'game.paused',
      'scenario.slug as scenarioSlug',
      'scenario.name as scenarioName',
    )
    .orderBy('game.started_at', 'desc');
  if (scenarioSlug) {
    query = query.where('scenario.slug', scenarioSlug);
  }
  return query;
};

// Force a game to ASSESSMENT state (admin override, no socket involvement).
const finishGame = async (id) => {
  const game = await db('game').where({ id }).first();
  if (!game) {
    const err = new Error(`Game "${id}" not found.`);
    err.statusCode = 404;
    err.code = 'GAME_NOT_FOUND';
    throw err;
  }
  const [updated] = await db('game')
    .where({ id })
    .update({ state: 'ASSESSMENT' })
    .returning('*');
  return updated;
};

// Delete a game and all related runtime rows in FK-safe order.
const deleteGame = async (id) => {
  const game = await db('game').where({ id }).first();
  if (!game) {
    const err = new Error(`Game "${id}" not found.`);
    err.statusCode = 404;
    err.code = 'GAME_NOT_FOUND';
    throw err;
  }
  await db.transaction(async (trx) => {
    await trx('game_log').where({ game_id: id }).delete();
    await trx('game_injection').where({ game_id: id }).delete();
    await trx('game_system').where({ game_id: id }).delete();
    await trx('game_mitigation').where({ game_id: id }).delete();
    await trx('game').where({ id }).delete();
  });
  return { deleted: true, id };
};

module.exports = {
  createGame,
  getGame,
  changeMitigation,
  performAction,
  startSimulation,
  pauseSimulation,
  makeResponses,
  deliverGameInjection,
  makeNonCorrectInjectionResponse,
  performCurveball,
  listGames,
  finishGame,
  deleteGame,
};
