// migrations/20260615000000_recommendations_to_array.js
//
// An event (injection) can reference several recommendations in Airtable, and
// each recommendation is a single, unitary item that must not be split apart.
// The column was previously a single text value, which forced us to keep only
// the first linked recommendation and made the frontend newline-split it.
//
// This converts injection.recommendations to text[] so the full list of
// recommendation names round-trips as a real array. Existing single values are
// preserved as one-element arrays; the down migration joins them back with
// newlines (the previous on-read behavior).

exports.up = (knex) =>
  knex.raw(`
    ALTER TABLE injection
    ALTER COLUMN recommendations TYPE text[]
    USING (
      CASE
        WHEN recommendations IS NULL THEN NULL
        ELSE ARRAY[recommendations]
      END
    )
  `);

exports.down = (knex) =>
  knex.raw(`
    ALTER TABLE injection
    ALTER COLUMN recommendations TYPE text
    USING (
      CASE
        WHEN recommendations IS NULL THEN NULL
        ELSE array_to_string(recommendations, E'\\n')
      END
    )
  `);
