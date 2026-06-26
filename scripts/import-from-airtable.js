/**
 * CLI wrapper for importing a scenario's content from Airtable into the
 * database.
 *
 * What it does:
 * - Accepts a scenario slug via --slug or SCENARIO_SLUG env var
 * - Resolves the Airtable base ID from AIRTABLE_BASE_IDS
 * - Calls importScenarioFromAirtable and prints row counts on success
 *
 * Important notes:
 * - This is a thin command-line entrypoint only. The real import logic lives
 *   in src/util/importScenarioFromAirtable.js.
 * - --slug takes precedence over SCENARIO_SLUG if both are provided.
 * - The script always destroys the shared Knex connection before exit.
 */

const db = require('../src/models/db');
const importScenarioFromAirtable = require('../src/util/importScenarioFromAirtable');
const { getAirtableBaseId } = require('../src/util/airtable');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--slug') {
      out.slug = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function main(argv = process.argv) {
  try {
    const args = parseArgs(argv);
    const scenarioSlug = args.slug || process.env.SCENARIO_SLUG;

    if (!scenarioSlug) {
      // eslint-disable-next-line no-console
      console.error(
        'Error: scenario slug is required. Pass --slug <slug> or set SCENARIO_SLUG.',
      );
      process.exit(1);
    }

    const accessToken = process.env.AIRTABLE_ACCESS_TOKEN;
    if (!accessToken) {
      // eslint-disable-next-line no-console
      console.error('Error: AIRTABLE_ACCESS_TOKEN is not set.');
      process.exit(1);
    }

    const baseId = getAirtableBaseId(scenarioSlug);

    // eslint-disable-next-line no-console
    console.log(`Importing scenario "${scenarioSlug}" from Airtable...`);

    const result = await importScenarioFromAirtable({
      accessToken,
      baseId,
      scenarioSlug,
    });

    // eslint-disable-next-line no-console
    console.log(`Imported scenario: ${scenarioSlug}`);
    // eslint-disable-next-line no-console
    console.log('Row counts:', result.counts);
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
