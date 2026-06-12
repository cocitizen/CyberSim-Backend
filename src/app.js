const helmet = require('helmet');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const expressPino = require('express-pino-logger');
const crypto = require('crypto');

const logger = require('./logger');
const db = require('./models/db');
const config = require('./config');

const {
  getScenarioBySlug,
  listScenariosWithCounts,
  deleteScenarioBySlug,
} = require('./models/scenario');
const {
  listGames,
  finishGame,
  deleteGame,
  advanceTime,
} = require('./models/game');
const { getAARData } = require('./models/aar');
const { getResponsesByScenarioId } = require('./models/response');
const { getInjectionsByScenarioId } = require('./models/injection');
const { getActionsByScenarioId } = require('./models/action');

const {
  loadScenarioRevision,
} = require('./services/scenario/loadScenarioRevision');
const {
  listAvailableRevisions,
} = require('./services/scenario/listAvailableRevisions');

const importScenarioFromAirtable = require('./util/importScenarioFromAirtable');
const { getAirtableBaseId } = require('./util/airtable');
const { transformValidationErrors } = require('./util/errors');

const SCENARIO_SLUG_REGEX = /^[a-z0-9-]+$/;

// ---------------------------------------------------------------------------
// Admin middleware
// ---------------------------------------------------------------------------

/**
 * Enforce HTTPS in production. AWS EB/ELB terminates SSL and sets the
 * x-forwarded-proto header. Requests that arrive over plain HTTP are
 * rejected before any admin logic runs.
 * In non-production environments the check is skipped so local dev works.
 */
function requireHttps(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto !== 'https') {
      return res.status(403).json({
        error: 'HTTPS_REQUIRED',
        message: 'Admin endpoints require HTTPS.',
      });
    }
  }
  return next();
}

/**
 * Require a valid admin password supplied in the X-Admin-Password request
 * header. Reads the password from config.migrationPassword (the existing
 * IMPORT_PASSWORD env var) so no new secrets are needed.
 */
function requireAdminPassword(req, res, next) {
  const password = req.headers['x-admin-password'];
  const configured = config.migrationPassword;
  if (!configured) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD_NOT_CONFIGURED' });
  }
  if (!password) {
    return res.status(401).json({
      error: 'PASSWORD_REQUIRED',
      message: 'X-Admin-Password header is required.',
    });
  }
  if (password !== configured) {
    return res
      .status(401)
      .json({ error: 'INVALID_PASSWORD', message: 'Invalid admin password.' });
  }
  return next();
}

const app = express();

// Wrap async route handlers so thrown errors reach the error middleware.
// Express 4 does not catch async throws automatically.
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

logger.info({ commit: process.env.GIT_COMMIT || 'unknown' }, 'App loaded');

// Resolve the requested scenario slug and return rows from one
// scenario-scoped static table filtered by scenario_id.
async function getScenarioRecords(tableName, scenarioSlug) {
  const scenario = await getScenarioBySlug(scenarioSlug?.trim() || 'cso');
  return db(tableName).where({ scenario_id: scenario.id });
}

app.use(helmet());
app.use(expressPino({ logger }));
app.use(bodyParser.json());
app.use('/admin', requireHttps);

app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
});

const allowedOrigins = (process.env.UI_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests like curl or health checks with no Origin header
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  }),
);

app.get('/', async (req, res) => {
  try {
    await db.raw('SELECT 1;');
  } catch (_) {
    res.status(500);
    res.send({ status: 'not ok' });
    return;
  }
  res.status(200);
  res.send({
    status: 'ok',
  });
});

app.get('/health', async (req, res) => {
  try {
    await db.raw('SELECT 1;');
    res.status(200).send({ status: 'ok' });
  } catch (err) {
    logger.error({ err }, 'Health check failed');
    res.status(503).send({ status: 'not ok' });
  }
});

app.get('/health/airtable', async (req, res) => {
  try {
    const token = process.env.AIRTABLE_ACCESS_TOKEN;
    const baseIdsRaw = process.env.AIRTABLE_BASE_IDS || '';

    if (!token || !baseIdsRaw) {
      return res.status(500).json({
        ok: false,
        message: 'Missing AIRTABLE_ACCESS_TOKEN or AIRTABLE_BASE_IDS',
      });
    }

    // Use the first configured base as a connectivity sanity check.
    const firstEntry = baseIdsRaw.split(',')[0].trim();
    const baseId = firstEntry.split(':')[1];

    const url = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: 'Airtable meta API check failed',
        status: response.status,
        error: body?.error,
      });
    }

    return res.json({
      ok: true,
      baseId,
      tables: (body?.tables || []).map((t) => ({
        id: t.id,
        name: t.name,
      })),
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err?.message || 'Unexpected error',
    });
  }
});

// health: database connectivity check
app.get('/health/db', async (req, res) => {
  try {
    // db is your knex instance from src/models/db
    // If you already have it in this file, reuse it.
    const result = await db.raw('select 1 as ok');

    // knex raw returns slightly different shapes depending on driver;
    // for pg it’s usually { rows: [...] }
    const ok = result?.rows?.[0]?.ok === 1 || result?.rows?.[0]?.ok === '1';
    return res.json({
      ok,
      message: 'Database reachable',
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: 'Database not reachable',
      error: err?.message,
    });
  }
});

// Returns name and slug for the requested scenario.
app.get(
  '/scenario',
  asyncRoute(async (req, res) => {
    const scenario = await getScenarioBySlug(
      req.query.scenarioSlug?.trim() || 'cso',
    );
    res.json({ slug: scenario.slug, name: scenario.name });
  }),
);

// Static scenario data is exposed via the REST API.
app.get(
  '/mitigations',
  asyncRoute(async (req, res) => {
    const records = await getScenarioRecords(
      'mitigation',
      req.query.scenarioSlug,
    );
    res.json(records);
  }),
);

app.get(
  '/locations',
  asyncRoute(async (req, res) => {
    const records = await getScenarioRecords(
      'location',
      req.query.scenarioSlug,
    );
    res.json(records);
  }),
);

app.get(
  '/dictionary',
  asyncRoute(async (req, res) => {
    const records = await getScenarioRecords(
      'dictionary',
      req.query.scenarioSlug,
    );
    res.json(records.map(({ word, synonym }) => ({ word, synonym })));
  }),
);

app.get(
  '/systems',
  asyncRoute(async (req, res) => {
    const records = await getScenarioRecords('system', req.query.scenarioSlug);
    res.json(records);
  }),
);

app.get(
  '/injections',
  asyncRoute(async (req, res) => {
    const scenario = await getScenarioBySlug(
      req.query.scenarioSlug?.trim() || 'cso',
    );
    const records = await getInjectionsByScenarioId(scenario.id);
    res.json(records);
  }),
);

app.get(
  '/responses',
  asyncRoute(async (req, res) => {
    const scenario = await getScenarioBySlug(
      req.query.scenarioSlug?.trim() || 'cso',
    );
    const records = await getResponsesByScenarioId(scenario.id);
    res.json(records);
  }),
);

app.get(
  '/actions',
  asyncRoute(async (req, res) => {
    const scenario = await getScenarioBySlug(
      req.query.scenarioSlug?.trim() || 'cso',
    );
    const records = await getActionsByScenarioId(scenario.id);
    res.json(records);
  }),
);

app.get(
  '/curveballs',
  asyncRoute(async (req, res) => {
    const records = await getScenarioRecords(
      'curveball',
      req.query.scenarioSlug,
    );
    res.json(records);
  }),
);

// ---------------------------------------------------------------------------
// Admin: scenario management
// ---------------------------------------------------------------------------

// GET /admin/scenarios — list all scenarios with counts; no password required
app.get(
  '/admin/scenarios',
  asyncRoute(async (req, res) => {
    const scenarios = await listScenariosWithCounts();
    res.json({ scenarios });
  }),
);

// GET /admin/scenarios/available — list revision tags on disk; no password required
app.get('/admin/scenarios/available', (req, res) => {
  res.json({ tags: listAvailableRevisions() });
});

// POST /admin/scenarios/load — load a revision from disk into the DB
app.post(
  '/admin/scenarios/load',
  requireAdminPassword,
  asyncRoute(async (req, res) => {
    const { tag } = req.body || {};

    if (!tag || typeof tag !== 'string') {
      return res.status(400).json({
        error: 'TAG_REQUIRED',
        message: 'Body must include a tag field (e.g. "cso@2026-03-19.1").',
      });
    }

    const atIndex = tag.indexOf('@');
    if (atIndex === -1) {
      return res.status(400).json({
        error: 'INVALID_TAG_FORMAT',
        message:
          'Tag must be in the format "slug@revision" (e.g. "cso@2026-03-19.1").',
      });
    }

    const scenarioSlug = tag.slice(0, atIndex);
    const scenarioRevision = tag.slice(atIndex + 1);

    if (!SCENARIO_SLUG_REGEX.test(scenarioSlug)) {
      return res.status(400).json({
        error: 'INVALID_SCENARIO_SLUG',
        message:
          'Scenario slug must contain only lowercase letters, numbers, and hyphens.',
      });
    }

    try {
      const result = await loadScenarioRevision({
        scenarioSlug,
        scenarioRevision,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      if (err.code === 'ACTIVE_GAMES_EXIST') {
        return res.status(409).json({
          error: 'ACTIVE_GAMES_EXIST',
          message: err.message,
          activeGames: err.activeGames,
        });
      }
      const msg = err.message || '';
      if (
        msg.includes('manifest mismatch') ||
        msg.includes('migration mismatch') ||
        msg.includes('not found')
      ) {
        return res.status(400).json({ error: 'LOAD_ERROR', message: msg });
      }
      logger.error({ tag, err: err.stack }, 'Scenario load failed');
      return res
        .status(500)
        .json({ error: 'INTERNAL_ERROR', message: 'Scenario load failed.' });
    }
  }),
);

// DELETE /admin/scenarios/:slug — remove scenario + static content from DB
app.delete(
  '/admin/scenarios/:slug',
  requireAdminPassword,
  asyncRoute(async (req, res) => {
    try {
      const result = await deleteScenarioBySlug(req.params.slug);
      return res.json(result);
    } catch (err) {
      if (err.code === 'SCENARIO_NOT_FOUND') {
        return res.status(404).json({ error: err.code, message: err.message });
      }
      if (err.code === 'ACTIVE_GAMES_EXIST') {
        return res.status(409).json({
          error: err.code,
          message: err.message,
          activeGames: err.activeGames,
        });
      }
      if (err.code === 'HISTORICAL_GAMES_EXIST') {
        return res.status(409).json({
          error: err.code,
          message: err.message,
          gameCount: err.gameCount,
        });
      }
      logger.error(
        { slug: req.params.slug, err: err.stack },
        'Scenario delete failed',
      );
      return res
        .status(500)
        .json({ error: 'INTERNAL_ERROR', message: 'Scenario delete failed.' });
    }
  }),
);

// ---------------------------------------------------------------------------
// Admin: game management
// ---------------------------------------------------------------------------

// GET /admin/games — list games, optional ?scenarioSlug= filter
app.get(
  '/admin/games',
  requireAdminPassword,
  asyncRoute(async (req, res) => {
    const games = await listGames({ scenarioSlug: req.query.scenarioSlug });
    res.json({ games });
  }),
);

// POST /admin/games/:id/finish — force game to ASSESSMENT (no socket involvement)
app.post(
  '/admin/games/:id/finish',
  requireAdminPassword,
  asyncRoute(async (req, res) => {
    try {
      const game = await finishGame(req.params.id);
      return res.json({ ok: true, game });
    } catch (err) {
      if (err.code === 'GAME_NOT_FOUND') {
        return res.status(404).json({ error: err.code, message: err.message });
      }
      logger.error({ id: req.params.id, err: err.stack }, 'Game finish failed');
      return res
        .status(500)
        .json({ error: 'INTERNAL_ERROR', message: 'Game finish failed.' });
    }
  }),
);

// GET /admin/game/advance/:gameId — advance the in-game clock for testing
// Query param: ?time=<minutes> (default 60). Game must be in SIMULATION state.
app.get(
  '/admin/game/advance/:gameId',
  requireAdminPassword,
  asyncRoute(async (req, res) => {
    const rawTime = req.query.time;
    const minutes = rawTime === undefined ? 60 : Number(rawTime);

    if (!Number.isFinite(minutes) || minutes <= 0) {
      return res.status(400).json({
        error: 'INVALID_TIME',
        message: 'Query param "time" must be a positive number of minutes.',
      });
    }

    try {
      const game = await advanceTime(req.params.gameId, minutes);
      return res.json({ ok: true, advancedMinutes: minutes, game });
    } catch (err) {
      if (err.code === 'GAME_NOT_FOUND') {
        return res.status(404).json({ error: err.code, message: err.message });
      }
      if (err.code === 'INVALID_GAME_STATE') {
        return res.status(409).json({ error: err.code, message: err.message });
      }
      logger.error(
        { id: req.params.gameId, err: err.stack },
        'Game advance time failed',
      );
      return res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Game advance time failed.',
      });
    }
  }),
);

// DELETE /admin/games/:id — delete game and all related rows
app.delete(
  '/admin/games/:id',
  requireAdminPassword,
  asyncRoute(async (req, res) => {
    try {
      const result = await deleteGame(req.params.id);
      return res.json(result);
    } catch (err) {
      if (err.code === 'GAME_NOT_FOUND') {
        return res.status(404).json({ error: err.code, message: err.message });
      }
      logger.error({ id: req.params.id, err: err.stack }, 'Game delete failed');
      return res
        .status(500)
        .json({ error: 'INTERNAL_ERROR', message: 'Game delete failed.' });
    }
  }),
);

app.post('/admin/scenarios/import', async (req, res) => {
  const { scenarioSlug, password } = req.body || {};
  const normalizedScenarioSlug = scenarioSlug?.trim();

  if (!normalizedScenarioSlug) {
    return res.status(400).json({
      error: 'SCENARIO_SLUG_REQUIRED',
      message: 'Scenario slug is required.',
    });
  }

  if (!SCENARIO_SLUG_REGEX.test(normalizedScenarioSlug)) {
    return res.status(400).json({
      error: 'INVALID_SCENARIO_SLUG',
      message:
        'Scenario slug must contain only lowercase letters, numbers, and hyphens.',
    });
  }

  if (typeof password !== 'string' || !password) {
    return res.status(400).send({
      message: 'Scenario import password is required.',
    });
  }

  const configuredPassword = config.migrationPassword;
  if (!configuredPassword) {
    return res.status(500).send({ message: 'Scenario import disabled.' });
  }

  if (password !== configuredPassword) {
    return res.status(400).json({
      password: 'Invalid scenario import password',
    });
  }

  const accessToken = process.env.AIRTABLE_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).send({
      message:
        'Server is missing Airtable configuration (AIRTABLE_ACCESS_TOKEN).',
    });
  }

  let baseId;
  try {
    baseId = getAirtableBaseId(normalizedScenarioSlug);
  } catch (err) {
    return res.status(400).send({ message: err.message });
  }

  try {
    await importScenarioFromAirtable({
      accessToken,
      baseId,
      scenarioSlug: normalizedScenarioSlug,
    });

    return res.status(200).send({
      ok: true,
      message: `Scenario "${normalizedScenarioSlug}" imported successfully.`,
    });
  } catch (err) {
    if (err.error === 'AUTHENTICATION_REQUIRED') {
      return res.status(400).send({
        message: 'Invalid Airtable access token (server configuration).',
      });
    }

    if (err.error === 'NOT_FOUND') {
      return res.status(400).send({
        message: `Invalid Airtable base id for scenario "${normalizedScenarioSlug}".`,
      });
    }

    if (err.error === 'NOT_AUTHORIZED') {
      logger.error(
        {
          scenarioSlug: normalizedScenarioSlug,
          airtableError: err.error,
          airtableMessage: err.message,
          statusCode: err.statusCode,
          tableName: err.tableName,
          viewName: err.viewName,
          stack: err.stack,
        },
        'Airtable import authorization error',
      );

      const authorizationErrorMessage = err.tableName
        ? `Airtable rejected access while reading table "${err.tableName}"${
            err.viewName ? ` view "${err.viewName}"` : ''
          }. Check that the table/view exists and that the token can read it.`
        : 'Token does not have access to this base or lacks required scopes.';

      return res.status(400).send({
        validation: true,
        message:
          'Airtable authorization error. Check the base access and token scopes (data.records:read, schema.bases:read).',
        errors: [
          {
            message: authorizationErrorMessage,
          },
        ],
      });
    }

    if (err.code === 'ACTIVE_GAMES_EXIST') {
      return res.status(409).send({
        message: `Cannot import scenario "${normalizedScenarioSlug}" while active games exist.`,
      });
    }

    if (err.validation) {
      const errors = transformValidationErrors(err);
      return res.status(400).send({
        validation: true,
        message: err.message,
        errors,
      });
    }

    logger.error(
      {
        scenarioSlug: normalizedScenarioSlug,
        message: err.message,
        stack: err.stack,
      },
      'Scenario import failed',
    );

    return res.status(500).send({
      message:
        'There was an internal server error during scenario import. Please contact the developers to fix it.',
    });
  }
});

// GET /games/:gameId/aar — After Action Review data for a completed game
app.get(
  '/games/:gameId/aar',
  asyncRoute(async (req, res) => {
    const data = await getAARData(req.params.gameId);
    res.json(data);
  }),
);

// Final error handler (must be after routes)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.statusCode || 500;

  // Always log full details + stack
  logger.error({
    msg: 'Unhandled error',
    status,
    method: req.method,
    path: req.originalUrl,
    err: err?.stack || err,
  });

  // Client-safe response
  res.status(status).json({
    error: err.code || 'INTERNAL_ERROR',
    message: status < 500 ? err.message : 'Server error',
  });
});

module.exports = app;
