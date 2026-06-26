function transformSchemaError(schemaError) {
  return {
    message: `A schema error occurred when querying the ${schemaError.tableName} table. Please check if the table is set correctly!`,
  };
}

function transformValidationError(validationError) {
  return validationError.errors.map((error) => {
    const [id, message] = error.split('.');
    const idx = Number(id.slice(1, -1));
    return {
      value: validationError.value[idx],
      message: `${message} in ${validationError.tableName}`,
    };
  });
}

function transformValidationErrors(validationErrors) {
  if (Array.isArray(validationErrors)) {
    return validationErrors
      .map((validationError) =>
        validationError.validation
          ? transformValidationError(validationError)
          : transformSchemaError(validationError),
      )
      .flat();
  }
  return transformValidationError(validationErrors);
}

// Airtable error codes the import route handles with dedicated responses.
const airtableAccessErrorCodes = ['AUTHENTICATION_REQUIRED', 'NOT_AUTHORIZED'];

function throwNecessaryValidationErrors(validationResponses, message) {
  const errors = validationResponses
    .filter((table) => table.status === 'rejected')
    .map((error) => error.reason);
  if (errors.length) {
    // Airtable access errors must keep their .error code so the route handler
    // can branch on it; bundling them into the validation array would mask
    // them as generic schema errors.
    const accessError = errors.find((err) =>
      airtableAccessErrorCodes.includes(err?.error),
    );
    if (accessError) {
      throw accessError;
    }
    errors.message = message;
    errors.validation = true;
    throw errors;
  }
}

module.exports = {
  transformValidationErrors,
  throwNecessaryValidationErrors,
};
