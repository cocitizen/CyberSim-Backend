// tests/scenarioImportRoute.test.js

const request = require('supertest');

jest.mock('../src/util/importScenarioFromAirtable', () => jest.fn());
jest.mock('../src/util/airtable', () => ({
  getAirtableBaseId: jest.fn(),
}));
jest.mock('../src/config', () => ({
  migrationPassword: 'test-import-password',
}));
jest.mock('../src/logger', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    child: jest.fn(() => mockLogger),
  };
  return mockLogger;
});

const app = require('../src/app');
const importScenarioFromAirtable = require('../src/util/importScenarioFromAirtable');
const { getAirtableBaseId } = require('../src/util/airtable');

describe('POST /admin/scenarios/import', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AIRTABLE_ACCESS_TOKEN: 'test-airtable-token',
    };

    jest.clearAllMocks();
    getAirtableBaseId.mockReturnValue('appTESTBASE');
    importScenarioFromAirtable.mockResolvedValue();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns 200 on successful scenario import', async () => {
    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'cso',
      password: 'test-import-password',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      dryRun: false,
      message: 'Scenario "cso" imported successfully.',
    });

    expect(getAirtableBaseId).toHaveBeenCalledWith('cso');
    expect(importScenarioFromAirtable).toHaveBeenCalledWith({
      accessToken: 'test-airtable-token',
      baseId: 'appTESTBASE',
      scenarioSlug: 'cso',
      dryRun: false,
    });
  });

  it('returns 400 when password is missing', async () => {
    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'cso',
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'Scenario import password is required.',
    });

    expect(getAirtableBaseId).not.toHaveBeenCalled();
    expect(importScenarioFromAirtable).not.toHaveBeenCalled();
  });

  it('returns 400 when password is invalid', async () => {
    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'cso',
      password: 'wrong-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      password: 'Invalid scenario import password',
    });

    expect(getAirtableBaseId).not.toHaveBeenCalled();
    expect(importScenarioFromAirtable).not.toHaveBeenCalled();
  });

  it('returns 400 when scenario slug is missing', async () => {
    const response = await request(app).post('/admin/scenarios/import').send({
      password: 'test-import-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'SCENARIO_SLUG_REQUIRED',
      message: 'Scenario slug is required.',
    });

    expect(getAirtableBaseId).not.toHaveBeenCalled();
    expect(importScenarioFromAirtable).not.toHaveBeenCalled();
  });

  it('returns 400 when scenario slug has invalid characters', async () => {
    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'CSO',
      password: 'test-import-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_SCENARIO_SLUG',
      message:
        'Scenario slug must contain only lowercase letters, numbers, and hyphens.',
    });

    expect(getAirtableBaseId).not.toHaveBeenCalled();
    expect(importScenarioFromAirtable).not.toHaveBeenCalled();
  });

  it('returns 500 when scenario import is disabled', async () => {
    jest.resetModules();

    jest.doMock('../src/util/importScenarioFromAirtable', () => jest.fn());
    jest.doMock('../src/util/airtable', () => ({
      getAirtableBaseId: jest.fn(),
    }));
    jest.doMock('../src/config', () => ({
      migrationPassword: '',
    }));

    jest.mock('../src/logger', () => {
      const mockLogger = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        trace: jest.fn(),
        child: jest.fn(() => mockLogger),
      };

      return mockLogger;
    });

    // eslint-disable-next-line global-require
    const disabledApp = require('../src/app');

    const response = await request(disabledApp)
      .post('/admin/scenarios/import')
      .send({
        scenarioSlug: 'cso',
        password: 'anything',
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      message: 'Scenario import disabled.',
    });
  });

  it('returns 500 when AIRTABLE_ACCESS_TOKEN is missing', async () => {
    delete process.env.AIRTABLE_ACCESS_TOKEN;

    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'cso',
      password: 'test-import-password',
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      message:
        'Server is missing Airtable configuration (AIRTABLE_ACCESS_TOKEN).',
    });

    expect(getAirtableBaseId).not.toHaveBeenCalled();
    expect(importScenarioFromAirtable).not.toHaveBeenCalled();
  });

  it('returns 400 when no Airtable base ID is configured for the scenario', async () => {
    getAirtableBaseId.mockImplementation(() => {
      throw new Error('No Airtable base ID configured for scenario "blurgle"');
    });

    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'blurgle',
      password: 'test-import-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'No Airtable base ID configured for scenario "blurgle"',
    });

    expect(importScenarioFromAirtable).not.toHaveBeenCalled();
  });

  it('returns 400 for Airtable authentication errors', async () => {
    importScenarioFromAirtable.mockRejectedValue({
      error: 'AUTHENTICATION_REQUIRED',
    });

    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'cso',
      password: 'test-import-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'Invalid Airtable access token (server configuration).',
    });
  });

  it('returns 400 for Airtable base-not-found errors', async () => {
    importScenarioFromAirtable.mockRejectedValue({
      error: 'NOT_FOUND',
    });

    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'cso',
      password: 'test-import-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'Invalid Airtable base id for scenario "cso".',
    });
  });

  it('returns 400 for Airtable authorization errors', async () => {
    importScenarioFromAirtable.mockRejectedValue({
      error: 'NOT_AUTHORIZED',
      message: 'You are not authorized to perform this operation',
      statusCode: 403,
      tableName: 'events',
      viewName: 'Grid view',
    });

    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'cso',
      password: 'test-import-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      validation: true,
      message:
        'Airtable authorization error. Check the base access and token scopes (data.records:read, schema.bases:read).',
      errors: [
        {
          message:
            'Airtable rejected access while reading table "events" view "Grid view". Check that the table/view exists and that the token can read it.',
        },
      ],
    });
  });

  it('returns 400 with the fallback message for authorization errors without a table name', async () => {
    importScenarioFromAirtable.mockRejectedValue({
      error: 'NOT_AUTHORIZED',
      message: 'You are not authorized to perform this operation',
      statusCode: 403,
    });

    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'cso',
      password: 'test-import-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      validation: true,
      message:
        'Airtable authorization error. Check the base access and token scopes (data.records:read, schema.bases:read).',
      errors: [
        {
          message:
            'Token does not have access to this base or lacks required scopes.',
        },
      ],
    });
  });

  it('returns 409 when active games exist', async () => {
    importScenarioFromAirtable.mockRejectedValue({
      code: 'ACTIVE_GAMES_EXIST',
    });

    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'cso',
      password: 'test-import-password',
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      message: 'Cannot import scenario "cso" while active games exist.',
    });
  });

  it('returns 400 for validation errors from the importer', async () => {
    importScenarioFromAirtable.mockRejectedValue({
      validation: true,
      message: 'Validation failed',
      errors: ['[0].Missing required field'],
      value: [{ id: 'row-1' }],
      tableName: 'events',
    });

    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'cso',
      password: 'test-import-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      validation: true,
      message: 'Validation failed',
      errors: [
        {
          value: { id: 'row-1' },
          message: 'Missing required field in events',
        },
      ],
    });
  });

  it('returns 500 for unexpected import errors', async () => {
    importScenarioFromAirtable.mockRejectedValue(
      new Error('Something unexpected happened'),
    );

    const response = await request(app).post('/admin/scenarios/import').send({
      scenarioSlug: 'cso',
      password: 'test-import-password',
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      message:
        'There was an internal server error during scenario import. Please contact the developers to fix it.',
    });
  });
});

describe('POST /admin/scenarios/validate', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AIRTABLE_ACCESS_TOKEN: 'test-airtable-token',
    };

    jest.clearAllMocks();
    getAirtableBaseId.mockReturnValue('appTESTBASE');
    importScenarioFromAirtable.mockResolvedValue();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns 200 with counts and runs a dry run that writes nothing', async () => {
    importScenarioFromAirtable.mockResolvedValue({
      dryRun: true,
      counts: { injections: 24, responses: 18 },
    });

    const response = await request(app).post('/admin/scenarios/validate').send({
      scenarioSlug: 'cso',
      password: 'test-import-password',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      dryRun: true,
      message: 'Scenario "cso" validated successfully. No changes were made.',
      counts: { injections: 24, responses: 18 },
    });

    expect(importScenarioFromAirtable).toHaveBeenCalledWith({
      accessToken: 'test-airtable-token',
      baseId: 'appTESTBASE',
      scenarioSlug: 'cso',
      dryRun: true,
    });
  });

  it('still requires a valid password', async () => {
    const response = await request(app).post('/admin/scenarios/validate').send({
      scenarioSlug: 'cso',
      password: 'wrong-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      password: 'Invalid scenario import password',
    });

    expect(importScenarioFromAirtable).not.toHaveBeenCalled();
  });

  it('surfaces importer validation errors the same way import does', async () => {
    importScenarioFromAirtable.mockRejectedValue({
      validation: true,
      message: 'Validation failed',
      errors: ['[0].Missing required field'],
      value: [{ id: 'row-1' }],
      tableName: 'events',
    });

    const response = await request(app).post('/admin/scenarios/validate').send({
      scenarioSlug: 'cso',
      password: 'test-import-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      validation: true,
      message: 'Validation failed',
      errors: [
        {
          value: { id: 'row-1' },
          message: 'Missing required field in events',
        },
      ],
    });
  });
});
