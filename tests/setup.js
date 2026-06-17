// tests/setup.js
require('dotenv/config');

if (!process.env.DB_URL || !process.env.DB_URL.includes('cybersim_test')) {
  throw new Error(
    `Refusing to run tests against non-test DB_URL: ${process.env.DB_URL}`,
  );
}

const db = require('../src/models/db');
const resetAllTables = require('./resetAllTables');
const seedTestData = require('./seedTestData');

async function verifyDatabaseConnection(database) {
  try {
    await database.raw('select 1');
  } catch (err) {
    console.error('\n❌ Cannot connect to the test database.\n');

    console.error('DB_URL:', process.env.DB_URL);

    console.error('\nCommon causes:');
    console.error('• Docker/Postgres container is not running');
    console.error('• DB_URL host/port is wrong');
    console.error('• Postgres not accepting connections\n');

    console.error('Try starting the DB:');
    console.error('  docker compose -f docker-compose-dev.yaml up -d db\n');

    throw err;
  }
}

module.exports = async () => {
  await verifyDatabaseConnection(db);

  // Clear all data BEFORE rolling back. The composite-PK down-migrations
  // re-add single-column (id) primary keys, which fail to build a unique index
  // if multi-scenario rows sharing ids are still present from a previous run.
  // `latest()` first guarantees the tables exist (fresh DB or stale schema).
  await db.migrate.latest();
  await resetAllTables();

  await db.migrate.rollback({}, true);
  await db.migrate.latest();

  await resetAllTables();
  await seedTestData(db);

  await db.destroy();
};
