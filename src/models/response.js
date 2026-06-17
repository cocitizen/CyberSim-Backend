const db = require('./db');

const getResponseWithCost = (responseWithMitigationCosts) => {
  const { mitCost, ...response } = responseWithMitigationCosts;
  if (response.cost !== null) {
    return response;
  }

  return { ...response, cost: mitCost || 0 };
};

const getResponsesById = async (responseIds, scenarioId) => {
  const query = db('response')
    .select('response.*', 'mitigation.cost as mitCost')
    .leftOuterJoin('mitigation', function joinSameScenarioMitigation() {
      // Join to the mitigation in the SAME scenario. Without the scenario
      // match, a mitigation id shared across scenarios duplicates the response
      // row (composite PK: id is unique only per scenario).
      this.on('response.mitigation_id', '=', 'mitigation.id').andOn(
        'response.scenario_id',
        '=',
        'mitigation.scenario_id',
      );
    })
    .whereIn('response.id', responseIds);

  if (scenarioId) {
    query.where({ 'response.scenario_id': scenarioId });
  }

  const responses = await query;
  return responses.map((response) => getResponseWithCost(response));
};

const getResponses = async () => {
  const records = await db('response')
    .select('response.*', 'mitigation.cost as mitCost')
    .leftOuterJoin('mitigation', function joinSameScenarioMitigation() {
      // Join to the mitigation in the SAME scenario. Without the scenario
      // match, a mitigation id shared across scenarios duplicates the response
      // row (composite PK: id is unique only per scenario).
      this.on('response.mitigation_id', '=', 'mitigation.id').andOn(
        'response.scenario_id',
        '=',
        'mitigation.scenario_id',
      );
    });
  return records.map((response) => getResponseWithCost(response));
};

const getResponsesByScenarioId = async (scenarioId) => {
  const records = await db('response')
    .select('response.*', 'mitigation.cost as mitCost')
    .leftOuterJoin('mitigation', function joinSameScenarioMitigation() {
      // Join to the mitigation in the SAME scenario. Without the scenario
      // match, a mitigation id shared across scenarios duplicates the response
      // row (composite PK: id is unique only per scenario).
      this.on('response.mitigation_id', '=', 'mitigation.id').andOn(
        'response.scenario_id',
        '=',
        'mitigation.scenario_id',
      );
    })
    .where({ 'response.scenario_id': scenarioId });

  return records.map((response) => getResponseWithCost(response));
};

module.exports = {
  getResponses,
  getResponsesById,
  getResponsesByScenarioId,
};
