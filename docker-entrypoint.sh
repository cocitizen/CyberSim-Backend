#!/bin/sh
set -e

echo "Running database migrations..."
npm run migrate

echo "Running cso seed...!"
SCENARIO_TAG=cso@2026-03-19.1 npm run reset-db:scenario

## we could insert a fully deployed, or simulation started instance here, to start it or activate it.
echo "Inserting AAR related Game state aar_test"
node -r dotenv/config scripts/prepare-aar-test.js --all aar_test

echo "Starting server..."
exec node index.js
