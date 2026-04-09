// tests/seedTestData.js
module.exports = async function seedTestData(db) {
  // Truncate all tables in FK-safe order so this function is idempotent —
  // safe to call against a non-empty DB without duplicate-key errors.
  // Runtime tables first (they reference game), then static content,
  // then the scenario parent row last.
  await db('game_log').delete();
  await db('game_mitigation').delete();
  await db('game_system').delete();
  await db('game_injection').delete();
  await db('game').delete();
  await db('action_role').delete();
  await db('injection_response').delete();
  await db('curveball').delete();
  await db('action').delete();
  // injection has a self-referential FK (followup_injection → injection.id),
  // so null it out before deleting to avoid constraint errors.
  await db('injection').update({ followup_injection: null });
  await db('injection').delete();
  await db('response').delete();
  await db('mitigation').delete();
  await db('role').delete();
  await db('dictionary').delete();
  await db('location').delete();
  await db('system').delete();
  await db('scenario').delete();

  // SCENARIO — must be inserted first; all static content FKs reference it.
  const [scenario] = await db('scenario')
    .insert({ slug: 'cso', name: 'CSO Scenario' })
    .returning('*');

  const scenarioId = scenario.id;

  // SYSTEMS
  await db('system').insert([
    {
      id: 'S1',
      name: 'Party website',
      description: '',
      type: 'party',
      scenario_id: scenarioId,
    },
    {
      id: 'S2',
      name: 'DB',
      description: '',
      type: 'hq',
      scenario_id: scenarioId,
    },
  ]);

  // ROLES
  await db('role').insert([
    { id: 'R1', name: 'Candidate 1', scenario_id: scenarioId },
    { id: 'R2', name: 'Candidate 2', scenario_id: scenarioId },
  ]);

  // MITIGATIONS
  await db('mitigation').insert([
    {
      id: 'M1',
      description: 'Mitigation 1',
      category: 'Operation',
      cost: 1000,
      is_hq: true,
      is_local: true,
      scenario_id: scenarioId,
    },
    {
      id: 'M2',
      description: 'Mitigation 2',
      category: 'Operation',
      cost: 1200,
      is_hq: false,
      is_local: true,
      scenario_id: scenarioId,
    },
  ]);

  // RESPONSES
  await db('response').insert([
    {
      id: 'RP1',
      description: 'Change office lock at LB',
      cost: 0,
      mitigation_id: null,
      systems_to_restore: ['S2'],
      required_mitigation: 'M1',
      required_mitigation_type: 'local',
      scenario_id: scenarioId,
    },
    {
      id: 'RP2',
      description: 'Change office lock at LB',
      cost: 0,
      mitigation_id: 'M2',
      systems_to_restore: [],
      required_mitigation: null,
      required_mitigation_type: null,
      scenario_id: scenarioId,
    },
  ]);

  // DICTIONARY
  await db('dictionary').insert([
    {
      id: 'rec8jJttwZ7gSK4F4',
      word: 'poll',
      synonym: 'poll',
      scenario_id: scenarioId,
    },
    {
      id: 'recGrOxugbY8ZiF2r',
      word: 'budget',
      synonym: 'funds',
      scenario_id: scenarioId,
    },
  ]);

  // INJECTIONS (two-pass insert so followup_injection FK is always safe)

  // 1) Insert all injections with followup_injection = null
  await db('injection').insert([
    {
      id: 'I1',
      title: 'Injection 1',
      description: 'Injection 1',
      trigger_time: 120000,
      location: 'local',
      type: 'Table',
      recipient_role: 'LB role',
      asset_code: '1',
      poll_change: -0.5,
      budget_change: -500,
      systems_to_disable: ['S1'],
      skipper_mitigation: 'M1',
      recommendations: 'Placeholder recommendation 1',
      followup_injection: null,
      scenario_id: scenarioId,
    },
    {
      id: 'I2',
      title: 'Injection 2',
      description: 'Injection 2',
      trigger_time: 240000,
      location: 'hq',
      type: 'Table',
      recipient_role: 'Hq role',
      asset_code: '2',
      poll_change: -0.5,
      systems_to_disable: [],
      skipper_mitigation: null,
      recommendations: 'Placeholder recommendation 2',
      followup_injection: null,
      scenario_id: scenarioId,
    },
    {
      id: 'I3',
      title: 'Injection 3',
      description: 'Injection 3',
      trigger_time: 340000,
      location: 'hq',
      type: 'Table',
      recipient_role: 'Hq role',
      asset_code: '3',
      poll_change: null,
      systems_to_disable: [],
      skipper_mitigation: 'M2',
      recommendations: 'Placeholder recommendation 3',
      followup_injection: null,
      scenario_id: scenarioId,
    },
  ]);

  // 2) Update the follow-up link after both rows exist
  await db('injection')
    .where({ id: 'I1' })
    .update({ followup_injection: 'I2' });

  // INJECTION_RESPONSE (join table)
  await db('injection_response').insert([
    { response_id: 'RP1', injection_id: 'I1', scenario_id: scenarioId },
    { response_id: 'RP2', injection_id: 'I2', scenario_id: scenarioId },
  ]);

  // ACTIONS
  await db('action').insert([
    {
      id: 'A1',
      description: 'Hold national campaign rally',
      type: 'hq',
      cost: 1000,
      budget_increase: 0,
      poll_increase: 5,
      required_systems: ['S1', 'S2'],
      scenario_id: scenarioId,
    },
    {
      id: 'A2',
      description: 'Hold national campaign rally',
      type: 'local',
      cost: 1000,
      budget_increase: 0,
      poll_increase: 5,
      required_systems: [],
      scenario_id: scenarioId,
    },
  ]);

  // ACTION_ROLE (join table)
  await db('action_role').insert([
    { action_id: 'A1', role_id: 'R1', scenario_id: scenarioId },
    { action_id: 'A1', role_id: 'R2', scenario_id: scenarioId },
    { action_id: 'A2', role_id: 'R2', scenario_id: scenarioId },
  ]);

  // CURVEBALLS
  await db('curveball').insert([
    {
      id: 'C4',
      description: 'Disaster',
      budget_change: -1000,
      poll_change: -10,
      scenario_id: scenarioId,
    },
    {
      id: 'C7',
      description: 'Miracle',
      budget_change: 1500,
      poll_change: 10,
      scenario_id: scenarioId,
    },
    {
      id: 'C8',
      description: 'Oh My God',
      lose_all_budget: true,
      scenario_id: scenarioId,
    },
  ]);
};
