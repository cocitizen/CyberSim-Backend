// seeds/02_scenario_seed.js
//
// Loads a versioned scenario revision from:
//   seeds/scenarios/<scenario>/<revision>/data/*.json
//
// Choose the scenario revision via env var:
//   SCENARIO_TAG="scenario@revision"  (e.g., "cso@2026-03-03.1")

const fs = require('fs');
const path = require('path');
const normalizeSnapshotInjections = require('../src/services/scenario/normalizeSnapshotInjections');

function formatBullets(items) {
  if (!items || items.length === 0) return '  (none found)';
  return items.map((x) => `  - ${x}`).join('\n');
}

function parseScenarioTag(tag) {
  if (!tag || typeof tag !== 'string' || !tag.includes('@')) {
    throw new Error(
      'SCENARIO_TAG must be set to "scenario@revision" (e.g., SCENARIO_TAG="cso@2026-03-03.1")',
    );
  }

  const [scenario, revision] = tag.split('@');

  if (!scenario || !revision) {
    throw new Error(
      `Invalid SCENARIO_TAG format: "${tag}". Expected "scenario@revision".`,
    );
  }

  return { scenario, revision };
}

function listDirs(absDir) {
  try {
    return fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function readJson(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  return JSON.parse(raw);
}

function loadScenarioJson(scenarioDir, filename) {
  const absPath = path.join(scenarioDir, 'data', filename);
  if (!fs.existsSync(absPath)) return null;
  return readJson(absPath);
}

function verifyManifestMatchesTag({ scenario, revision }, manifest) {
  const mScenario = manifest?.scenario;
  const mRevision = manifest?.revision;

  if (mScenario !== scenario || mRevision !== revision) {
    throw new Error(
      [
        'Scenario revision manifest mismatch.',
        `- SCENARIO_TAG: ${scenario}@${revision}`,
        `- Manifest:     ${mScenario}@${mRevision}`,
        '',
        'The scenario revision folder does not match its manifest.',
        'This usually means the revision was copied or renamed incorrectly.',
      ].join('\n'),
    );
  }
}

async function getDbLatestMigration(knex) {
  const row = await knex('knex_migrations')
    .select('name')
    .orderBy('id', 'desc')
    .first();
  return row?.name || null;
}

async function verifyMigrationMatches(knex, manifest) {
  const dbLatest = await getDbLatestMigration(knex);
  const scenarioLatest = manifest?.db?.latest_migration || null;

  // If either is missing, don't block seeding.
  if (!dbLatest || !scenarioLatest) return;

  if (dbLatest !== scenarioLatest) {
    throw new Error(
      [
        'Scenario revision migration mismatch.',
        `- DB latest migration:              ${dbLatest}`,
        `- Scenario revision expects:        ${scenarioLatest}`,
        '',
        'Fix:',
        '1) Run `npm run reset-db:scenario` (rebuild schema), OR',
        '2) Re-save the scenario revision under the current schema.',
      ].join('\n'),
    );
  }
}

exports.seed = async (knex) => {
  // Require SCENARIO_TAG to be explicitly set. A silent return here is dangerous
  // because reset-db:scenario rebuilds the schema first — if this seed then
  // does nothing, the DB is left empty with no scenario row.
  if (!process.env.SCENARIO_TAG) {
    throw new Error(
      'SCENARIO_TAG is not set. Use: SCENARIO_TAG="scenario@revision" npm run seed:scenario',
    );
  }

  const { scenario, revision } = parseScenarioTag(process.env.SCENARIO_TAG);

  // This file lives in `seeds/`, so scenario revisions are in
  // `seeds/scenarios/...`
  const scenariosRoot =
    process.env.SCENARIO_SEED_ROOT || path.join(__dirname, 'scenarios');
  const scenarioDir = path.join(scenariosRoot, scenario, revision);
  const manifestPath = path.join(scenarioDir, 'manifest.json');

  if (!fs.existsSync(scenarioDir)) {
    const scenarios = listDirs(scenariosRoot);
    const revisions = listDirs(path.join(scenariosRoot, scenario));

    throw new Error(
      [
        'Scenario revision not found for SCENARIO_TAG.',
        `- SCENARIO_TAG: ${scenario}@${revision}`,
        `- Expected folder: ${scenarioDir}`,
        '',
        'Available scenarios under seeds/scenarios:',
        formatBullets(scenarios),
        '',
        `Available revisions for scenario "${scenario}" (if it exists):`,
        formatBullets(revisions),
        '',
        'Fix:',
        '1) Choose one of the available scenario@revision tags above, OR',
        '2) Save a scenario revision:',
        `   npm run save:scenario -- --tag ${scenario}@${revision}`,
      ].join('\n'),
    );
  }

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      [
        'Scenario revision manifest.json not found.',
        `- SCENARIO_TAG: ${scenario}@${revision}`,
        `- Expected: ${manifestPath}`,
        '',
        'This usually means the scenario revision save is incomplete.',
      ].join('\n'),
    );
  }

  const manifest = readJson(manifestPath);

  // eslint-disable-next-line no-console
  console.log(
    `Loading scenario revision ${scenario}@${revision} from ${scenarioDir}`,
  );

  verifyManifestMatchesTag({ scenario, revision }, manifest);
  await verifyMigrationMatches(knex, manifest);

  // Load tables (missing file => empty array, except dictionary which is optional)
  const system = loadScenarioJson(scenarioDir, 'system.json') || [];
  const role = loadScenarioJson(scenarioDir, 'role.json') || [];
  const mitigation = loadScenarioJson(scenarioDir, 'mitigation.json') || [];
  const response = loadScenarioJson(scenarioDir, 'response.json') || [];
  const injection = normalizeSnapshotInjections(
    loadScenarioJson(scenarioDir, 'injection.json') || [],
  );
  const action = loadScenarioJson(scenarioDir, 'action.json') || [];
  const curveball = loadScenarioJson(scenarioDir, 'curveball.json') || [];
  const dictionary = loadScenarioJson(scenarioDir, 'dictionary.json'); // optional
  const location = loadScenarioJson(scenarioDir, 'location.json') || [];
  const actionRole = loadScenarioJson(scenarioDir, 'action_role.json') || [];
  const injectionResponse =
    loadScenarioJson(scenarioDir, 'injection_response.json') || [];

  await knex.transaction(async (trx) => {
    // Delete in FK-safe order so the seed is idempotent — safe to run
    // against a non-empty DB without duplicate-key errors.
    await trx('game_log').delete();
    await trx('game_mitigation').delete();
    await trx('game_system').delete();
    await trx('game_injection').delete();
    await trx('game').delete();
    await trx('action_role').delete();
    await trx('injection_response').delete();
    await trx('curveball').delete();
    await trx('action').delete();
    await trx('injection').update({ followup_injection: null });
    await trx('injection').delete();
    await trx('response').delete();
    await trx('mitigation').delete();
    await trx('role').delete();
    await trx('dictionary').delete();
    await trx('location').delete();
    await trx('system').delete();
    await trx('scenario').delete();

    // Create the scenario row and tag all static rows with its id.
    // Saved JSON files do not include scenario_id (it is stripped on save)
    // so we add it here, mirroring the Airtable import flow.
    const [scenarioRow] = await trx('scenario')
      .insert({ slug: scenario, name: manifest.name || scenario })
      .returning('*');
    const scenarioId = scenarioRow.id;
    const tag = (rows) =>
      rows.map((row) => ({ ...row, scenario_id: scenarioId }));

    // Insert parents first
    if (system.length) await trx('system').insert(tag(system));
    if (location.length) await trx('location').insert(tag(location));
    if (role.length) await trx('role').insert(tag(role));
    if (mitigation.length) await trx('mitigation').insert(tag(mitigation));
    if (response.length) await trx('response').insert(tag(response));

    // injection has self-FK followup_injection; do a safe two-pass insert
    if (injection.length) {
      const withoutFollowups = tag(injection).map((row) => ({
        ...row,
        followup_injection: null,
      }));

      await trx('injection').insert(withoutFollowups);

      const followups = injection
        .filter((row) => row.followup_injection)
        .map((row) => ({
          id: row.id,
          followup_injection: row.followup_injection,
        }));

      const followupUpdates = followups.map((row) =>
        trx('injection')
          .where({ id: row.id })
          .update({ followup_injection: row.followup_injection }),
      );

      await Promise.all(followupUpdates);
    }

    if (action.length) await trx('action').insert(tag(action));
    if (curveball.length) await trx('curveball').insert(tag(curveball));
    if (dictionary && dictionary.length) {
      await trx('dictionary').insert(tag(dictionary));
    }

    // Insert joins last
    if (actionRole.length) await trx('action_role').insert(tag(actionRole));
    if (injectionResponse.length) {
      await trx('injection_response').insert(tag(injectionResponse));
    }
  });
};
