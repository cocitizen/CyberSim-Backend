/**
 * Load a versioned scenario revision from disk into the database.
 *
 * What it does:
 * - Reads static content from seeds/scenarios/<scenario>/<revision>/data/*.json
 * - Verifies the manifest matches the requested tag and the DB migration level
 * - Upserts the scenario row (insert or update name)
 * - Blocks if active games exist for that scenario
 * - Replaces only that scenario's static content inside a transaction
 *
 * Important notes:
 * - This is the scenario-scoped counterpart to saveScenarioRevision.
 * - No other scenario's data is touched — safe to run alongside live CSO games.
 * - Runtime game state is preserved; only static content is replaced.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../models/db');
const assertNoActiveGames = require('./assertNoActiveGames');
const replaceScenarioContent = require('./replaceScenarioContent');
const normalizeSnapshotInjections = require('./normalizeSnapshotInjections');

function readJson(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  return JSON.parse(raw);
}

function loadJson(scenarioDir, filename) {
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
      ].join('\n'),
    );
  }
}

async function verifyMigrationMatches(manifest) {
  const scenarioLatest = manifest?.db?.latest_migration || null;
  if (!scenarioLatest) return;

  const row = await db('knex_migrations')
    .select('name')
    .orderBy('id', 'desc')
    .first();
  const dbLatest = row?.name || null;
  if (!dbLatest) return;

  if (dbLatest !== scenarioLatest) {
    throw new Error(
      [
        'Scenario revision migration mismatch.',
        `- DB latest migration:       ${dbLatest}`,
        `- Scenario revision expects: ${scenarioLatest}`,
        '',
        'Fix:',
        '1) Run `npm run reset-db:scenario` (rebuild schema), OR',
        '2) Re-save the scenario revision under the current schema.',
      ].join('\n'),
    );
  }
}

async function loadScenarioRevision({
  scenarioSlug,
  scenarioRevision,
  rootDir,
}) {
  const scenariosRoot =
    rootDir || path.join(__dirname, '..', '..', '..', 'seeds', 'scenarios');
  const scenarioDir = path.join(scenariosRoot, scenarioSlug, scenarioRevision);
  const manifestPath = path.join(scenarioDir, 'manifest.json');

  if (!fs.existsSync(scenarioDir)) {
    throw new Error(
      [
        'Scenario revision not found.',
        `- SCENARIO_TAG: ${scenarioSlug}@${scenarioRevision}`,
        `- Expected folder: ${scenarioDir}`,
      ].join('\n'),
    );
  }

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      [
        'Scenario revision manifest.json not found.',
        `- Expected: ${manifestPath}`,
      ].join('\n'),
    );
  }

  const manifest = readJson(manifestPath);

  verifyManifestMatchesTag(
    { scenario: scenarioSlug, revision: scenarioRevision },
    manifest,
  );
  await verifyMigrationMatches(manifest);

  const system = loadJson(scenarioDir, 'system.json') || [];
  const role = loadJson(scenarioDir, 'role.json') || [];
  const mitigation = loadJson(scenarioDir, 'mitigation.json') || [];
  const response = loadJson(scenarioDir, 'response.json') || [];
  const injection = normalizeSnapshotInjections(
    loadJson(scenarioDir, 'injection.json') || [],
  );
  const action = loadJson(scenarioDir, 'action.json') || [];
  const curveball = loadJson(scenarioDir, 'curveball.json') || [];
  const dictionary = loadJson(scenarioDir, 'dictionary.json');
  const location = loadJson(scenarioDir, 'location.json') || [];
  const actionRole = loadJson(scenarioDir, 'action_role.json') || [];
  const injectionResponse =
    loadJson(scenarioDir, 'injection_response.json') || [];

  const [scenarioRow] = await db('scenario')
    .insert({
      slug: scenarioSlug,
      name: manifest.name || scenarioSlug,
      revision: scenarioRevision,
    })
    .onConflict('slug')
    .merge()
    .returning('*');

  const scenarioId = scenarioRow.id;

  await assertNoActiveGames({ scenarioId, scenarioSlug });

  const tag = (rows) =>
    (rows || []).map((row) => ({ ...row, scenario_id: scenarioId }));

  await db.transaction(async (trx) => {
    await replaceScenarioContent({
      trx,
      scenarioId,
      systems: tag(system),
      locations: tag(location),
      roles: tag(role),
      mitigations: tag(mitigation),
      responses: tag(response),
      injections: tag(injection),
      actions: tag(action),
      curveballs: tag(curveball),
      dictionary: tag(dictionary),
      injectionResponse: tag(injectionResponse),
      actionRole: tag(actionRole),
    });
  });

  return {
    scenarioSlug,
    scenarioRevision,
    counts: {
      system: system.length,
      role: role.length,
      mitigation: mitigation.length,
      response: response.length,
      injection: injection.length,
      action: action.length,
      curveball: curveball.length,
      location: location.length,
      action_role: actionRole.length,
      injection_response: injectionResponse.length,
      ...(dictionary ? { dictionary: dictionary.length } : {}),
    },
  };
}

module.exports = { loadScenarioRevision };
