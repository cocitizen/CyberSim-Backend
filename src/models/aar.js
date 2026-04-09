const db = require('./db');

const getAARData = async (gameId) => {
  // 1. Fetch game state (need scenario_id for joins)
  const game = await db('game')
    .select('id', 'poll', 'budget', 'scenario_id')
    .where({ id: gameId })
    .first();

  if (!game) {
    const err = new Error('Game not found');
    err.statusCode = 404;
    err.code = 'GAME_NOT_FOUND';
    throw err;
  }

  // 2. Fetch game_injections joined to static injection data.
  //    injection uses composite PK (id, scenario_id) — filter by both.
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
      'injection.budget_change',
      'injection.skipper_mitigation',
      'injection.followup_injection',
    )
    .join('injection', 'game_injection.injection_id', 'injection.id')
    .where({
      'game_injection.game_id': gameId,
      'injection.scenario_id': game.scenario_id,
    });

  // 3. Fetch all injection_response rows for this scenario, including response details.
  const injectionResponses = await db('injection_response')
    .select('injection_response.injection_id', 'response.*')
    .join('response', 'injection_response.response_id', 'response.id')
    .where('injection_response.scenario_id', game.scenario_id);

  // 4. Fetch game_mitigation rows with mitigation details.
  const gameMitigations = await db('game_mitigation')
    .select(
      'game_mitigation.*',
      'mitigation.description',
      'mitigation.cost',
      'mitigation.category',
    )
    .join('mitigation', 'game_mitigation.mitigation_id', 'mitigation.id')
    .where({
      'game_mitigation.game_id': gameId,
      'mitigation.scenario_id': game.scenario_id,
    });

  // 5. Fetch game logs for mitigation purchase timestamps.
  const mitigationLogs = await db('game_log')
    .select('game_timer', 'mitigation_id')
    .where({ game_id: gameId, type: 'Budget Item Purchase' });

  // --- Build lookup maps ---

  const giByInjectionId = {};
  gameInjections.forEach((gi) => {
    giByInjectionId[gi.injection_id] = gi;
  });

  // Index possible responses by injection_id
  const responsesByInjectionId = {};
  injectionResponses.forEach((ir) => {
    if (!responsesByInjectionId[ir.injection_id]) {
      responsesByInjectionId[ir.injection_id] = [];
    }
    responsesByInjectionId[ir.injection_id].push(ir);
  });

  // Index mitigation purchase timestamps by mitigation_id
  const mitigationPurchaseTime = {};
  mitigationLogs.forEach((log) => {
    mitigationPurchaseTime[log.mitigation_id] = log.game_timer;
  });

  // Index game_mitigation rows by mitigation_id
  const gmByMitigationId = {};
  gameMitigations.forEach((gm) => {
    gmByMitigationId[gm.mitigation_id] = gm;
  });

  // Identify injections that are follow-ups of another (skip them as top-level entries).
  const followupIds = new Set();
  gameInjections.forEach((gi) => {
    if (gi.followup_injection) {
      followupIds.add(gi.followup_injection);
    }
  });

  // Build chains: only top-level injections, sorted by trigger_time.
  const chains = gameInjections
    .filter((gi) => !followupIds.has(gi.injection_id))
    .sort((a, b) => a.trigger_time - b.trigger_time)
    .map((gi) =>
      buildChainEntry(
        gi,
        giByInjectionId,
        responsesByInjectionId,
        gmByMitigationId,
        mitigationPurchaseTime,
      ),
    );

  return { game, chains, mitigations: gameMitigations };
};

function buildResponsesMade(predefinedResponsesMade, possibleResponses, gmByMitigationId) {
  return (predefinedResponsesMade || []).map((rId) => {
    const resp = possibleResponses.find((r) => r.id === rId) || {};
    const mitigation = resp.mitigation_id ? gmByMitigationId[resp.mitigation_id] : null;
    return {
      response_id: rId,
      description: resp.description || null,
      cost: resp.cost || null,
      mitigation_id: resp.mitigation_id || null,
      mitigation_description: mitigation?.description || null,
      systems_to_restore: resp.systems_to_restore || [],
    };
  });
}

function buildChainEntry(
  gi,
  giByInjectionId,
  responsesByInjectionId,
  gmByMitigationId,
  mitigationPurchaseTime,
) {
  const possibleResponses = responsesByInjectionId[gi.injection_id] || [];

  // Determine event category
  let category;
  if (gi.prevented) {
    category = 'prevented';
  } else if (gi.delivered) {
    category = 'injected';
  } else {
    category = 'not_delivered';
  }

  // Skipper mitigation info (what purchase prevents this event)
  let skipperMitigation = null;
  if (gi.skipper_mitigation) {
    const gm = gmByMitigationId[gi.skipper_mitigation];
    skipperMitigation = {
      mitigation_id: gi.skipper_mitigation,
      description: gm?.description || null,
      purchased: gm?.state || false,
      purchased_in_preparation: gm?.preparation || false,
      purchased_at:
        mitigationPurchaseTime[gi.skipper_mitigation] ??
        (gm?.preparation ? 0 : null),
    };
  }

  const responsesMade = buildResponsesMade(
    gi.predefined_responses_made,
    possibleResponses,
    gmByMitigationId,
  );

  // Follow-up injection chain
  let followup = null;
  if (gi.followup_injection) {
    const followupGi = giByInjectionId[gi.followup_injection];
    if (followupGi) {
      const followupResponses = responsesByInjectionId[followupGi.injection_id] || [];
      const followupResponsesMade = buildResponsesMade(
        followupGi.predefined_responses_made,
        followupResponses,
        gmByMitigationId,
      );

      followup = {
        injection_id: followupGi.injection_id,
        title: followupGi.title,
        description: followupGi.description,
        trigger_time: followupGi.trigger_time,
        poll_change: followupGi.poll_change,
        budget_change: followupGi.budget_change,
        systems_to_disable: followupGi.systems_to_disable,
        delivered: followupGi.delivered,
        delivered_at: followupGi.delivered_at,
        prevented: followupGi.prevented,
        prevented_at: followupGi.prevented_at,
        recommendations: followupGi.recommendations,
        possible_responses: followupResponses,
        responses_made: followupResponsesMade,
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
    budget_change: gi.budget_change,

    // Game-specific state
    category,
    delivered: gi.delivered,
    delivered_at: gi.delivered_at,
    prevented: gi.prevented,
    prevented_at: gi.prevented_at,

    // What purchase prevents this event (if any)
    skipper_mitigation: skipperMitigation,

    // Player responses to this injection
    possible_responses: possibleResponses,
    responses_made: responsesMade,
    is_response_correct: gi.is_response_correct,
    response_made_at: gi.response_made_at,
    custom_response: gi.custom_response,

    followup,
  };
}

module.exports = { getAARData };
