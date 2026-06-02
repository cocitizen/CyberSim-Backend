/**
 *
 * Save the current static content for one scenario from the database into a
 * versioned scenario revision on disk.
 *
 * What it does:
 * - Reads one scenario's static tables from PostgreSQL, filtered by scenario_id
 * - Normalizes exported rows for portability
 * - Writes revision JSON files and a manifest under
 *   `seeds/scenarios/<scenario>/<revision>/`
 *
 * Important notes:
 * - This file contains reusable service logic only; it is not a CLI entrypoint.
 * - Exported rows intentionally omit `scenario_id` because the destructive
 *   scenario seed recreates it on load.
 * - This service exports only static scenario content, not runtime game state.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const db = require('../../models/db');
const { getAirtableBaseId } = require('../../util/airtable');

function parseScenarioTag(tag) {
  if (!tag || typeof tag !== 'string' || !tag.includes('@')) {
    throw new Error(
      'Missing/invalid scenario tag. Expected "scenario@revision".',
    );
  }

  const [scenarioSlug, scenarioRevision] = tag.split('@');

  if (!scenarioSlug || !scenarioRevision) {
    throw new Error(
      `Invalid tag format: "${tag}". Expected "scenario@revision".`,
    );
  }

  return { scenarioSlug, scenarioRevision };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function safeGitCommit() {
  try {
    return execSync('git rev-parse HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

async function latestMigrationId() {
  try {
    const row = await db('knex_migrations')
      .select('name')
      .orderBy('id', 'desc')
      .first();
    return row?.name || null;
  } catch {
    return null;
  }
}

function normalizeRow(row) {
  const out = { ...row };

  delete out.scenario_id;

  if (out.poll_change != null) out.poll_change = Number(out.poll_change);
  if (out.poll_increase != null) out.poll_increase = Number(out.poll_increase);
  if (out.budget_change != null) out.budget_change = Number(out.budget_change);

  return out;
}

async function exportTableForScenario(scenarioId, tableName, orderBy = 'id') {
  const rows = await db(tableName)
    .select('*')
    .where({ scenario_id: scenarioId })
    .orderBy(orderBy);

  return rows.map(normalizeRow);
}

async function saveScenarioRevision({
  scenarioSlug,
  scenarioRevision,
  rootDir,
}) {
  const scenarioRow = await db('scenario')
    .where({ slug: scenarioSlug })
    .first();

  if (!scenarioRow) {
    throw new Error(`Scenario not found: "${scenarioSlug}"`);
  }

  const repoRoot = rootDir || path.join(__dirname, '..', '..', '..');
  const scenarioDir = path.join(
    repoRoot,
    'seeds',
    'scenarios',
    scenarioSlug,
    scenarioRevision,
  );
  const dataDir = path.join(scenarioDir, 'data');

  ensureDir(dataDir);

  const system = await exportTableForScenario(scenarioRow.id, 'system', 'id');
  const role = await exportTableForScenario(scenarioRow.id, 'role', 'id');
  const mitigation = await exportTableForScenario(
    scenarioRow.id,
    'mitigation',
    'id',
  );
  const response = await exportTableForScenario(
    scenarioRow.id,
    'response',
    'id',
  );
  const injection = await exportTableForScenario(
    scenarioRow.id,
    'injection',
    'id',
  );
  const location = await exportTableForScenario(
    scenarioRow.id,
    'location',
    'id',
  );
  const action = await exportTableForScenario(scenarioRow.id, 'action', 'id');
  const curveball = await exportTableForScenario(
    scenarioRow.id,
    'curveball',
    'id',
  );

  let dictionary = null;
  const hasDictionary = await db.schema.hasTable('dictionary');
  if (hasDictionary) {
    dictionary = await exportTableForScenario(
      scenarioRow.id,
      'dictionary',
      'id',
    );
  }

  const actionRole = await exportTableForScenario(
    scenarioRow.id,
    'action_role',
    'id',
  );
  const injectionResponse = await exportTableForScenario(
    scenarioRow.id,
    'injection_response',
    'id',
  );

  writeJson(path.join(dataDir, 'system.json'), system);
  writeJson(path.join(dataDir, 'role.json'), role);
  writeJson(path.join(dataDir, 'mitigation.json'), mitigation);
  writeJson(path.join(dataDir, 'response.json'), response);
  writeJson(path.join(dataDir, 'injection.json'), injection);
  writeJson(path.join(dataDir, 'action.json'), action);
  writeJson(path.join(dataDir, 'curveball.json'), curveball);
  writeJson(path.join(dataDir, 'action_role.json'), actionRole);
  writeJson(path.join(dataDir, 'location.json'), location);
  writeJson(path.join(dataDir, 'injection_response.json'), injectionResponse);

  if (dictionary) {
    writeJson(path.join(dataDir, 'dictionary.json'), dictionary);
  }

  const manifest = {
    tag: `${scenarioSlug}@${scenarioRevision}`,
    scenario: scenarioSlug,
    revision: scenarioRevision,
    name: scenarioRow.name || scenarioSlug,
    exported_at: new Date().toISOString(),
    airtable: {
      base_id: (() => {
        try {
          return getAirtableBaseId(scenarioSlug);
        } catch (_) {
          return null;
        }
      })(),
    },
    db: {
      latest_migration: await latestMigrationId(),
    },
    git: {
      commit: safeGitCommit(),
    },
    counts: {
      system: system.length,
      role: role.length,
      mitigation: mitigation.length,
      response: response.length,
      injection: injection.length,
      action: action.length,
      curveball: curveball.length,
      action_role: actionRole.length,
      injection_response: injectionResponse.length,
      location: location.length,
      ...(dictionary ? { dictionary: dictionary.length } : {}),
    },
  };

  writeJson(path.join(scenarioDir, 'manifest.json'), manifest);

  return {
    scenarioSlug,
    scenarioRevision,
    outputDir: scenarioDir,
  };
}

module.exports = {
  saveScenarioRevision,
  parseScenarioTag,
};
