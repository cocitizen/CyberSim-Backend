/**
 * Tests for scenario import error helpers.
 *
 * What this covers:
 * - bundling schema/validation rejections into a thrown validation array
 * - rethrowing Airtable access errors directly so the import route can
 *   branch on their error code instead of treating them as schema errors
 *
 * Important notes:
 * - This file focuses on the error helpers in src/util/errors.js, not route
 *   behavior. The route-level responses are covered in
 *   scenarioImportRoute.test.js.
 */

const { throwNecessaryValidationErrors } = require('../src/util/errors');

describe('throwNecessaryValidationErrors', () => {
  it('does not throw when all responses are fulfilled', () => {
    expect(() =>
      throwNecessaryValidationErrors(
        [{ status: 'fulfilled', value: [] }],
        'schema errors',
      ),
    ).not.toThrow();
  });

  it('throws the validation error array for schema rejections', () => {
    const schemaError = { validation: true, tableName: 'events', errors: [] };

    let thrown;
    try {
      throwNecessaryValidationErrors(
        [
          { status: 'fulfilled', value: [] },
          { status: 'rejected', reason: schemaError },
        ],
        'schema errors',
      );
    } catch (err) {
      thrown = err;
    }

    expect(Array.isArray(thrown)).toBe(true);
    expect(thrown.validation).toBe(true);
    expect(thrown.message).toBe('schema errors');
    expect(thrown[0]).toBe(schemaError);
  });

  it('rethrows Airtable access errors directly so their error code survives', () => {
    const accessError = {
      error: 'NOT_AUTHORIZED',
      statusCode: 403,
      tableName: 'events',
      viewName: 'Grid view',
    };

    let thrown;
    try {
      throwNecessaryValidationErrors(
        [
          { status: 'rejected', reason: { validation: true, errors: [] } },
          { status: 'rejected', reason: accessError },
        ],
        'schema errors',
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBe(accessError);
    expect(thrown.error).toBe('NOT_AUTHORIZED');
  });
});
