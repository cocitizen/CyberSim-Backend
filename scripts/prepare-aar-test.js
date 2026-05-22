/**
 * Prepares game state for AAR (After Action Review) testing.
 *
 * ─── Original mode ───────────────────────────────────────────────────────────
 * Takes a single running game and delivers every threat so responders can set
 * responses via the UI.
 *
 *   node -r dotenv/config scripts/prepare-aar-test.js <gameId>
 *   node -r dotenv/config scripts/prepare-aar-test.js --game <gameId>
 *
 * The game must be in SIMULATION state. The script leaves the game running but
 * ensures all injections appear as delivered.
 *
 * ─── All-cards mode ──────────────────────────────────────────────────────────
 * Creates ONE game that simultaneously exercises every AAR card type, covering
 * all TC scenarios from CyberSim-UI/docs/testing/after-action-review.md.
 *
 *   node -r dotenv/config scripts/prepare-aar-test.js --all <gameId>
 *
 * The <gameId> must not already exist. Uses the cso scenario.
 *
 * Card types and which injections produce them:
 *
 *   BLUE  (TC-3, TC-11) — Injection 1005 prevented by mitigation in Prep phase.
 *                         The BLUE chain also covers TC-11: because 1005 has a
 *                         followup_injection (→ 1022 "Strategy leaked"), buying the
 *                         skipper mitigation simultaneously prevents the parent AND
 *                         suppresses the follow-up from the top-level timeline entirely.
 *                         Expected on the AAR page:
 *                           • BLUE card for 1005 (EVENT PREVENTED)
 *                           • No connector below the blue card
 *                           • No card for 1022 anywhere (not gray, not nested blue)
 *
 *   GREEN (TC-4) — Injection 1000 delivered + correct response "Reformat computers"
 *                  → follow-up 1055 prevented
 *                  Chain: BLACK(1000) → GREEN connector → GREEN(1055)
 *
 *   RED only (TC-5) — Injection 1016 delivered, no response
 *                     → follow-up 1029 delivered, no post-event response
 *                     Chain: BLACK(1016) → RED connector → RED(1029)
 *
 *   RED+ORANGE (TC-6) — Injection 1011 delivered, custom incorrect response
 *                       → follow-up 1048 delivered + post-event response
 *                       Chain: BLACK(1011) → RED connector → RED(1048)
 *                              → GREEN connector → ORANGE
 *
 *   YELLOW — Injection 1010 delivered, correct response "Report phishing attempt"
 *             but response_made_at (900 000) > followup.delivered_at (780 000) → late.
 *             Follow-up 1012 already delivered by then.
 *             Chain: BLACK(1010) → YELLOW connector → RED(1012)
 *
 *   BLACK (TC-1/2/8) — Injection 1006 delivered, custom incorrect response, no follow-up
 *
 *   BLACK+GRAY — Injection 1001 (Amazon DataBreach) delivered, no response.
 *                Follow-up 1046 ("Executive Director's OFD emails leaked") left
 *                not-delivered and not-prevented, simulating a follow-up that was
 *                never triggered (e.g. game ended before its trigger time).
 *                Chain: BLACK(1001) → [connector] → GRAY(1046, NOT REACHED)
 *
 *   GRAY (TC-7/9) — All remaining injections left not-delivered
 *
 * Important notes (original mode):
 *   - delivered_at for each injection is set to the injection's trigger_time so
 *     the timeline looks natural. If trigger_time is NULL, 0 is used.
 *   - Injections already marked as prevented are left untouched.
 *   - millis_taken_before_started is set to 3 600 000 (1 h) and started_at is
 *     set to NOW() so the running clock reads ~1 h elapsed at the moment the
 *     script runs. This means the game stays live and the timer continues from
 *     the 1-hour mark.
 */

const db = require('../src/models/db');

// ---------------------------------------------------------------------------
// Seed data constants — cso@2026-03-19.1
// ---------------------------------------------------------------------------
const SCENARIO_SLUG = 'cso';

// Injection IDs referenced in the AAR test plan
const INJ = {
  // BLUE chain: 1005 prevented by mitigation; its follow-up 1022 suppressed
  id1005: 'recw1zsFvRJd4pOu2', // Incoming email (Spearphishing); trigger 420 000 ms; skipper MIT.twoFA; followup → 1022
  id1022: 'rec4O6rmlQn51TfbA', // Strategy leaked; trigger 1 500 000 ms; follow-up of 1005

  // GREEN chain: correct response to 1000 prevents follow-up 1055
  id1000: 'reccCt7XY8uRuGMKb', // Photo sharing on (infected) personal USB; trigger 180 000 ms; followup → 1055
  id1055: 'rechW2QnG1DxlEEgZ', // Ransomware attack disables GN computers; trigger 3 060 000 ms; follow-up of 1000

  // RED-only chain: 1016 no response → 1029 delivered, no post-event
  id1016: 'recRJh7cpEgDrAbQ0', // Grassroots Network organizer's phone stolen; trigger 540 000 ms; followup → 1029
  id1029: 'recWTfBD6BpH1RG8L', // Scandal due to private chats revealed; trigger 2 040 000 ms; follow-up of 1016

  // RED+ORANGE chain: 1011 no response → 1048 delivered + post-event response
  id1011: 'recgVVHrq7Xq5Qt9r', // Juran Knott leaves the party; trigger 660 000 ms; followup → 1048
  id1048: 'recHhJpOvsfUi3x7L', // Contact management system deleted; trigger 2 400 000 ms; follow-up of 1011

  // BLACK standalone: delivered, no response, no follow-up
  id1006: 'recaV5aL9GR8xYZdD', // Access to Facebook blocked in area around Vario; trigger 1 860 000 ms; no followup
  id1035: 'rec9WtN8StuxHPMY7', // Email server hacked; trigger 2 280 000 ms; no response, no followup

  // BLACK+GRAY: 1001 delivered, follow-up 1046 NOT delivered
  id1001: 'recaxARH7iyFC7Ngl', // Amazon databreach; trigger 180 000 ms; followup → 1046
  id1046: 'rechlZaoEnfCUQQq9', // Executive Director's OFD emails leaked; trigger 2 580 000 ms; follow-up of 1001

  // YELLOW chain: correct but late response to 1010 → follow-up 1012 still delivered
  id1010: 'rechCyEFqkDxd0n3H', // Facebook password reset phishing email; trigger 540 000 ms; followup → 1012
  id1012: 'recBBjpZwdawGLEdZ', // FB account hacked - embarrassing post; trigger 780 000 ms; follow-up of 1010
};

// Response IDs
const RESP = {
  reformatComputers: 'recrsPq1oq92DWMB8', // Correct response for injection 1000; cost 0
  payCMS: 'recUiufBbQTDq0uoX', // "Pay $1500 to restore CMS" — post-event response for injection 1048; cost 1500
  reportPhishing: 'recmfVJNJiMJIwRvZ', // "Report phishing attempt" — correct but late response for injection 1010; cost 0
};

// Mitigation ID
const MIT = {
  twoFA: 'recwp0KlSovcOxIiI', // "Implement two-factor authentication for Director" — prevents injection 1005
};

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = argv.slice(2);
  let gameId;
  let allGameId;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--game' && args[i + 1]) {
      gameId = args[i + 1];
      i += 1;
    } else if (args[i] === '--all' && args[i + 1]) {
      allGameId = args[i + 1];
      i += 1;
    } else if (!args[i].startsWith('--')) {
      gameId = args[i];
    }
  }

  return { gameId, allGameId };
}

// ---------------------------------------------------------------------------
// All-cards mode: create + configure a single game covering every card type
// ---------------------------------------------------------------------------
async function setupAllCards(gameId) {
  // 1. Verify the game does not already exist
  const existing = await db('game').where({ id: gameId }).first();
  if (existing) {
    console.error(
      `Game "${gameId}" already exists. Delete it first or choose a different ID.`,
    );
    process.exit(1);
  }

  // 2. Load the scenario
  const scenario = await db('scenario').where({ slug: SCENARIO_SLUG }).first();
  if (!scenario) {
    console.error(
      `Scenario "${SCENARIO_SLUG}" not found. Run the scenario seed first:\n` +
        `  SCENARIO_TAG=cso@2026-03-19.1 npm run seed:scenario`,
    );
    process.exit(1);
  }

  // 3. Create the game with all associated runtime rows
  await db.transaction(async (trx) => {
    await trx('game').insert({
      id: gameId,
      budget: 6000,
      poll: 55,
      scenario_id: scenario.id,
    });

    const systems = await trx('system')
      .select('id')
      .where({ scenario_id: scenario.id });
    if (systems.length) {
      await trx('game_system').insert(
        systems.map(({ id }) => ({
          game_id: gameId,
          system_id: id,
          state: true,
        })),
      );
    }

    const mitigations = await trx('mitigation')
      .select('id')
      .where({ scenario_id: scenario.id });
    if (mitigations.length) {
      await trx('game_mitigation').insert(
        mitigations.map(({ id }) => ({
          game_id: gameId,
          mitigation_id: id,
          state: false,
        })),
      );
    }

    const injections = await trx('injection')
      .select('id')
      .where({ scenario_id: scenario.id });
    if (injections.length) {
      await trx('game_injection').insert(
        injections.map(({ id }) => ({ game_id: gameId, injection_id: id })),
      );
    }
  });

  // 4. Apply per-card-type state in a single transaction

  await db.transaction(async (trx) => {
    // ── BLUE (TC-3, TC-11) ────────────────────────────────────────────────
    // Purchase the 2FA mitigation in Preparation; this causes injection 1005
    // to be prevented when the simulation starts.
    // TC-11: because 1005 has followup_injection → 1022 ("Strategy leaked"),
    // buying the skipper mitigation also suppresses 1022 from the AAR timeline
    // entirely. Injection 1022 stays in the default not-delivered state but
    // the AAR chain-builder excludes it as a top-level entry (it is neither
    // shown as a gray NOT REACHED card nor as a nested blue card).
    await trx('game_mitigation')
      .where({ game_id: gameId, mitigation_id: MIT.twoFA })
      .update({ state: true, preparation: true });

    await trx('game_injection')
      .where({ game_id: gameId, injection_id: INJ.id1005 })
      .update({ prevented: true, prevented_at: 0 });

    // ── GREEN chain (TC-4) ─────────────────────────────────────────────────
    // Injection 1000 delivered + correct response "Reformat computers".
    // The correct response prevents the follow-up (1055), mirroring the side
    // effect that makeResponses() applies in the real game flow.
    await trx('game_injection')
      .where({ game_id: gameId, injection_id: INJ.id1000 })
      .update({
        delivered: true,
        delivered_at: 180000,
        predefined_responses_made: [RESP.reformatComputers],
        is_response_correct: true,
        response_made_at: 300000,
      });

    await trx('game_injection')
      .where({ game_id: gameId, injection_id: INJ.id1055 })
      .update({ prevented: true, prevented_at: 300000 });

    // ── RED-only chain (TC-5) ──────────────────────────────────────────────
    // Injection 1016 delivered with no response; follow-up 1029 delivered
    // with no post-event mitigation response.
    await trx('game_injection')
      .where({ game_id: gameId, injection_id: INJ.id1016 })
      .update({ delivered: true, delivered_at: 540000 });

    await trx('game_injection')
      .where({ game_id: gameId, injection_id: INJ.id1029 })
      .update({ delivered: true, delivered_at: 2040000 });

    // ── RED+ORANGE chain (TC-6) ────────────────────────────────────────────
    // Injection 1011 delivered with no response; follow-up 1048 delivered and
    // marked with the post-event mitigation response "Pay $1500 to restore CMS".
    await trx('game_injection')
      .where({ game_id: gameId, injection_id: INJ.id1011 })
      .update({
        delivered: true,
        delivered_at: 660000,
        custom_response: 'We told Knott the decision was final and moved on.',
        is_response_correct: false,
        response_made_at: 720000,
      });

    await trx('game_injection')
      .where({ game_id: gameId, injection_id: INJ.id1048 })
      .update({
        delivered: true,
        delivered_at: 2400000,
        predefined_responses_made: [RESP.payCMS],
        is_response_correct: true,
        response_made_at: 2500000,
      });

    // ── BLACK standalone (TC-1/2/8) ────────────────────────────────────────
    // Injection 1006 delivered with a custom incorrect response and no follow-up.
    await trx('game_injection')
      .where({ game_id: gameId, injection_id: INJ.id1006 })
      .update({
        delivered: true,
        delivered_at: 1860000,
        custom_response: 'We asked staff to use mobile data instead.',
        is_response_correct: false,
        response_made_at: 1960000,
      });

    // Injection 1035 delivered with no response and no follow-up defined.
    await trx('game_injection')
      .where({ game_id: gameId, injection_id: INJ.id1035 })
      .update({ delivered: true, delivered_at: 2280000 });

    // ── BLACK + undelivered follow-up ──────────────────────────────────────
    // Injection 1001 (Amazon DataBreach) delivered with no response.
    // Its follow-up 1046 is left in the default state (delivered=false,
    // prevented=false), simulating a follow-up that was never triggered.
    await trx('game_injection')
      .where({ game_id: gameId, injection_id: INJ.id1001 })
      .update({ delivered: true, delivered_at: 180000 });
    // id1046 stays default: delivered=false, prevented=false

    // ── YELLOW chain (correct but late response) ──────────────────────────
    // Injection 1010 delivered; player reports the phishing attempt correctly
    // but only after the follow-up (1012) was already delivered
    // (response_made_at 900 000 > followup.delivered_at 780 000).
    // AARResponseIndicator shows yellow badge + warning icon.
    await trx('game_injection')
      .where({ game_id: gameId, injection_id: INJ.id1010 })
      .update({
        delivered: true,
        delivered_at: 540000,
        predefined_responses_made: [RESP.reportPhishing],
        is_response_correct: true,
        response_made_at: 900000,
      });

    await trx('game_injection')
      .where({ game_id: gameId, injection_id: INJ.id1012 })
      .update({ delivered: true, delivered_at: 780000 });

    // ── GRAY (TC-7/9) ──────────────────────────────────────────────────────
    // All remaining injections stay in the default not-delivered state.
    // No update needed — they were created with delivered=false, prevented=false.

    // ── Finalise: move game to ASSESSMENT state ────────────────────────────
    await trx('game').where({ id: gameId }).update({ state: 'ASSESSMENT' });
  });

  console.log(
    `\nGame "${gameId}" is ready for AAR testing (scenario: ${SCENARIO_SLUG}).\n`,
  );
  console.log('Card types present in the AAR timeline:');
  console.log(
    '  BLUE   — injection 1005 (prevented by 2FA mitigation purchased in Prep)  [TC-3]',
  );
  console.log(
    '           ↳ TC-11: follow-up 1022 "Strategy leaked" also shown as BLUE',
  );
  console.log(
    '              Chain: BLUE(1005) → [Followup event] → BLUE(1022, AVOIDED DAMAGE)',
  );
  console.log(
    '  GREEN  — injection 1000 (correct response) → follow-up 1055 avoided      [TC-4]',
  );
  console.log(
    '  RED    — injection 1016 (no response) → follow-up 1029 delivered          [TC-5]',
  );
  console.log(
    '  RED+ORANGE — injection 1011 (no response) → follow-up 1048 + post-event  [TC-6]',
  );
  console.log(
    '  YELLOW — injection 1010 (correct but late response) → follow-up 1012 still delivered',
  );
  console.log(
    '           (response_made_at 900 000 > followup.delivered_at 780 000 → yellow badge)',
  );
  console.log(
    '  BLACK  — injection 1006 (custom incorrect response, no follow-up)          [TC-2]',
  );
  console.log(
    '           injection 1035 (Email server hacked, no response, no follow-up)',
  );
  console.log(
    '  BLACK+GRAY — injection 1001 (Amazon DataBreach) delivered, follow-up 1046 not reached',
  );
  console.log(
    '  GRAY   — all remaining injections (not reached)                           [TC-7]',
  );
}

// ---------------------------------------------------------------------------
// Original mode
// ---------------------------------------------------------------------------
async function prepareExistingGame(gameId) {
  // 1. Load the game row
  const game = await db('game')
    .select(
      'id',
      'state',
      'paused',
      'millis_taken_before_started',
      'started_at',
    )
    .where({ id: gameId })
    .first();

  if (!game) {
    console.error(`Game not found: ${gameId}`);
    process.exit(1);
  }

  if (game.state !== 'SIMULATION') {
    console.error(
      `Game ${gameId} is in state "${game.state}". It must be in SIMULATION state.`,
    );
    process.exit(1);
  }

  const ONE_HOUR_MS = 60 * 60 * 1000; // 3 600 000

  // 2. Set the game clock to 1 hour elapsed.
  //    We do this by:
  //      - Setting millis_taken_before_started = 3 600 000
  //      - Setting started_at = NOW()
  //    Result: getTimeTaken() = (NOW - NOW) + 3 600 000 = 3 600 000 ms
  //    The live timer continues counting from the 1-hour mark.
  await db('game').where({ id: gameId }).update({
    millis_taken_before_started: ONE_HOUR_MS,
    started_at: db.fn.now(),
    paused: false,
  });

  console.log(
    `[1/2] Game clock set to 1 hour elapsed (started_at = NOW, millis_taken_before_started = ${ONE_HOUR_MS}).`,
  );

  // 3. Fetch all game_injection rows that have not been prevented
  const injections = await db('game_injection')
    .select(
      'game_injection.id',
      'game_injection.injection_id',
      'game_injection.delivered',
      'game_injection.prevented',
      'injection.trigger_time',
    )
    .leftJoin('injection', 'injection.id', 'game_injection.injection_id')
    .where({ 'game_injection.game_id': gameId });

  const toDeliver = injections.filter((i) => !i.prevented && !i.delivered);
  const alreadyDelivered = injections.filter((i) => i.delivered);
  const prevented = injections.filter((i) => i.prevented);

  if (toDeliver.length === 0) {
    console.log('[2/2] All threats already delivered — nothing to do.');
  } else {
    // Deliver each undelivered, non-prevented injection.
    // delivered_at = the injection's trigger_time (or 0 if NULL) so the event
    // appears at a sensible point in the game timeline.
    await db.transaction(async (trx) => {
      await Promise.all(
        toDeliver.map((injection) => {
          const deliveredAt =
            injection.trigger_time != null ? injection.trigger_time : 0;

          return trx('game_injection').where({ id: injection.id }).update({
            delivered: true,
            delivered_at: deliveredAt,
          });
        }),
      );
    });

    console.log(
      `[2/2] Delivered ${toDeliver.length} threat(s). ` +
        `(${alreadyDelivered.length} already delivered, ${prevented.length} prevented — left untouched.)`,
    );
  }

  console.log(`\nDone. Game ${gameId} is ready for AAR response testing.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { gameId, allGameId } = parseArgs(process.argv);

  if (allGameId) {
    await setupAllCards(allGameId);
    return;
  }

  if (!gameId) {
    console.error(
      'Usage:\n' +
        '  node -r dotenv/config scripts/prepare-aar-test.js <gameId>\n' +
        '  node -r dotenv/config scripts/prepare-aar-test.js --game <gameId>\n' +
        '  node -r dotenv/config scripts/prepare-aar-test.js --all <gameId>',
    );
    process.exit(1);
  }

  await prepareExistingGame(gameId);
}

main()
  .catch((err) => {
    console.error('Script failed:', err.message);
    process.exit(1);
  })
  .finally(() => db.destroy());
