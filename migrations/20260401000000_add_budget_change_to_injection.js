exports.up = (knex) =>
  knex.schema.table('injection', (t) => {
    t.decimal('budget_change').nullable();
  });

exports.down = (knex) =>
  knex.schema.table('injection', (t) => {
    t.dropColumn('budget_change');
  });
