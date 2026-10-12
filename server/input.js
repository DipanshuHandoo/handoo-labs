export function requireRecord(value, message = 'A JSON object is required.') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
  return value;
}

export function boundedInteger(value, name, minimum, maximum, fallback) {
  const number = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    const error = new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
    error.status = 400;
    throw error;
  }
  return number;
}

export function boundedBoolean(value, name, fallback) {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'boolean') {
    const error = new Error(`${name} must be true or false.`);
    error.status = 400;
    throw error;
  }
  return result;
}

export function boundedString(value, name, maximum, fallback = '') {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'string' || result.length > maximum) {
    const error = new Error(`${name} must be text with at most ${maximum} characters.`);
    error.status = 400;
    throw error;
  }
  return result;
}
