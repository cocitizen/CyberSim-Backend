/**
 * Import one scenario's authored content from Airtable into the database.
 *
 * What it does:
 * - Reads and validates Airtable source tables
 * - Transforms Airtable records into DB-shaped scenario content
 * - Upserts the scenario row and tags all static rows with scenario_id
 * - Blocks import when active games exist for that scenario
 * - Replaces only that scenario's static content inside a transaction
 *
 * Important notes:
 * - This file imports scenario content only. It does not run schema migrations.
 * - Runtime game state is intentionally preserved and is not recreated here.
 * - Static content replacement is delegated to replaceScenarioContent().
 */

/* eslint no-param-reassign: "off", camelcase: "off", no-restricted-syntax: "off", guard-for-in: "off", no-await-in-loop: "off" */

const Airtable = require('airtable');
const yup = require('yup');
const { dbSchemas, airtableSchemas } = require('./import_schemas');
const db = require('../models/db');
const logger = require('../logger');
const { throwNecessaryValidationErrors } = require('./errors');
const assertNoActiveGames = require('../services/scenario/assertNoActiveGames');
const replaceScenarioContent = require('../services/scenario/replaceScenarioContent');

const typeMap = {
  Table: 'Table',
  Background: 'Background',
  'System Board': 'Board',
};

async function validate(schema, items = [], tableName) {
  try {
    return await yup
      .array()
      .of(schema)
      .validate(items, { stripUnknown: true, abortEarly: false });
  } catch (err) {
    err.validation = true;
    err.tableName = tableName;
    throw err;
  }
}

function fetchTable(base, tableName) {
  const allFields = [];
  const viewName = 'Grid view';

  return new Promise((resolve, reject) => {
    base(tableName)
      .select({
        view: viewName,
      })
      .eachPage(
        (records, fetchNextPage) => {
          const fields = records.map((record) => ({
            ...record.fields,
            id: record.id,
          }));
          allFields.push(...fields);

          fetchNextPage();
        },
        function done(err) {
          if (err) {
            err.tableName = tableName;
            err.viewName = viewName;
            reject(err);
          } else {
            validate(airtableSchemas[tableName], allFields, tableName)
              .then(resolve)
              .catch(reject);
          }
        },
      );
  });
}

async function validateForDb(tableName, items) {
  return validate(dbSchemas[tableName], items, tableName);
}

function addPartyLocation(locations) {
  return locations?.includes('hq') && locations?.includes('local')
    ? 'party'
    : locations?.[0];
}

async function importScenarioFromAirtable({
  accessToken,
  baseId,
  scenarioSlug = 'cso',
}) {
  // connect to the airtable instance
  Airtable.configure({
    endpointUrl: 'https://api.airtable.com',
    apiKey: accessToken,
  });

  const base = Airtable.base(baseId);

  // do a starting "fake" fetch to check if the personal access token and table id are correct
  await fetchTable(base, 'handbook_categories');

  // define arrays for junctions tables that must be added at the end of the import
  const injectionResponse = [];
  const actionRole = [];

  const validatedAirtableTables = await Promise.allSettled([
    // fetch the backing tables that do not exist in our sql database and are only needed for data transformation
    fetchTable(base, 'purchased_mitigations_category'),
    fetchTable(base, 'handbook_categories'),
    fetchTable(base, 'recommendations'),
    fetchTable(base, 'event_types'),
    // fetch main tables
    fetchTable(base, 'locations'),
    fetchTable(base, 'dictionary'),
    fetchTable(base, 'events'),
    fetchTable(base, 'purchased_mitigations'),
    fetchTable(base, 'responses'),
    fetchTable(base, 'systems'),
    fetchTable(base, 'roles'),
    fetchTable(base, 'actions'),
    fetchTable(base, 'curveballs'),
  ]);

  throwNecessaryValidationErrors(
    validatedAirtableTables,
    'There were Airtable schema errors during the import. Please fix them inside your Airtable.',
  );

  const [
    rawPurchasedMitigationCategories,
    rawHandbookCategories,
    rawRecommendations,
    rawEventTypes,
    locations,
    dictionary,
    injections, // = events
    mitigations, // = purchased_mitigations
    responses,
    systems,
    roles,
    actions,
    curveballs,
  ] = validatedAirtableTables.map((table) => table.value);

  //  process the backing tables
  const purchasedMitigationCategories = rawPurchasedMitigationCategories.reduce(
    (obj, { name, id }) => ({ ...obj, [id]: name }),
    {},
  );

  const handbookCategories = rawHandbookCategories.reduce(
    (obj, { name, id }) => ({ ...obj, [id]: name }),
    {},
  );

  const locationsMap = locations.reduce(
    (obj, { id, location_code }) => ({
      ...obj,
      [id]: location_code,
    }),
    {},
  );

  const recommendations = rawRecommendations.reduce(
    (obj, { name, handbook_category, id }) => ({
      ...obj,
      [id]: `${handbookCategories[handbook_category]}: ${name}`,
      id,
    }),
    {},
  );

  const eventTypes = rawEventTypes.reduce(
    (obj, { name, id }) => ({
      ...obj,
      [id]: typeMap[name],
    }),
    {},
  );

  const rolesMap = roles.reduce(
    (obj, { name, id }) => ({
      ...obj,
      [id]: name,
    }),
    {},
  );

  // process events
  injections.forEach((injection) => {
    injection.location = locationsMap[injection.locations];
    injection.recommendations = recommendations[injection.recommendations];
    injection.type = eventTypes[injection.event_types] || 'Board';
    injection.followup_injection = injection.followup_event;
    injection.trigger_time *= 1000;
    injection.recipient_role = rolesMap[injection.role];
    injection.asset_code = injection.spreadsheet_id
      ? String(injection.spreadsheet_id)
      : undefined;
    injection.handbook_category =
      handbookCategories[injection.handbook_category] ?? null;
  });
  injections.forEach(({ id, response = [] }) => {
    response.forEach((responseId) =>
      injectionResponse.push({
        injection_id: id,
        response_id: responseId,
      }),
    );
  });

  // process mitigations
  mitigations.forEach((mitigation) => {
    mitigation.category = purchasedMitigationCategories[mitigation.category];
  });

  // process systems
  systems.forEach((system) => {
    system.type = addPartyLocation(
      system.locations.map((id) => locationsMap[id]),
    );
  });

  // process actions
  actions.forEach((action) => {
    action.type = locationsMap[action.locations];
  });
  actions.forEach(({ id, role = [] }) => {
    role.forEach((roleId) =>
      actionRole.push({ action_id: id, role_id: roleId }),
    );
  });

  // process locations
  locations.forEach((location) => {
    location.type = location.location_code;
  });

  // Upsert the scenario row so any configured slug works, not just the original
  // default scenario from the single-scenario era. If the slug already exists,
  // the merge is a no-op and we get the existing row back.
  const [scenario] = await db('scenario')
    .insert({ slug: scenarioSlug, name: scenarioSlug })
    .onConflict('slug')
    .merge()
    .returning('*');

  const scenarioId = scenario.id;

  const tag = (rows) =>
    rows.map((row) => ({ ...row, scenario_id: scenarioId }));

  const validatedSqlTables = await Promise.allSettled([
    validateForDb('location', tag(locations)),
    validateForDb('dictionary', tag(dictionary)),
    validateForDb('injection', tag(injections)),
    validateForDb('mitigation', tag(mitigations)),
    validateForDb('response', tag(responses)),
    validateForDb('system', tag(systems)),
    validateForDb('role', tag(roles)),
    validateForDb('action', tag(actions)),
    validateForDb('curveball', tag(curveballs)),
    validateForDb('injection_response', tag(injectionResponse)),
    validateForDb('action_role', tag(actionRole)),
  ]);

  throwNecessaryValidationErrors(
    validatedSqlTables,
    'Critical failure. There were SQL schema errors during the import.',
  );

  const [
    sqlLocations,
    sqlDictionary,
    sqlInjections,
    sqlMitigations,
    sqlResponses,
    sqlSystems,
    sqlRoles,
    sqlActions,
    sqlCurveballs,
    sqlInjectionResponse,
    sqlActionRole,
  ] = validatedSqlTables.map((table) => table.value);

  await assertNoActiveGames({ scenarioId, scenarioSlug });

  await db.transaction(async (trx) => {
    await replaceScenarioContent({
      trx,
      scenarioId,
      locations: sqlLocations,
      dictionary: sqlDictionary,
      injections: sqlInjections,
      mitigations: sqlMitigations,
      responses: sqlResponses,
      systems: sqlSystems,
      roles: sqlRoles,
      actions: sqlActions,
      curveballs: sqlCurveballs,
      injectionResponse: sqlInjectionResponse,
      actionRole: sqlActionRole,
    });
  });

  // Write out information about the updates
  logger.info(
    {
      baseId,
      mitigationCount: sqlMitigations.length,
      responseCount: sqlResponses.length,
      injectionCount: sqlInjections.length,
    },
    'Import inserted row counts',
  );
}

module.exports = importScenarioFromAirtable;
