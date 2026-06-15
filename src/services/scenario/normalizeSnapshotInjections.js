/**
 * Backward-compat shim for scenario snapshots saved before migration
 * 20260615000000_recommendations_to_array.
 *
 * The injection.recommendations column is now text[], but older injection.json
 * snapshots store it as a single string (or null). Coerce any legacy string
 * value into a one-element array so old revisions still load cleanly. Arrays and
 * null/undefined pass through unchanged.
 */
function normalizeSnapshotInjections(injections = []) {
  return injections.map((row) =>
    typeof row.recommendations === 'string'
      ? { ...row, recommendations: [row.recommendations] }
      : row,
  );
}

module.exports = normalizeSnapshotInjections;
