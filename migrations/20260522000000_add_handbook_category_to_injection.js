exports.up = (knex) =>
  knex.schema.table('injection', (t) => {
    t.string('handbook_category').nullable();
  });

exports.down = (knex) =>
  knex.schema.table('injection', (t) => {
    t.dropColumn('handbook_category');
  });
