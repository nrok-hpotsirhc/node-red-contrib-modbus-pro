'use strict';

/**
 * Parse a string to an integer, returning the default value
 * if the result is not a finite number. Unlike `parseInt(x) || default`,
 * this correctly handles 0 as a valid value (e.g. unitId 0 for TCP broadcast).
 * @param {*} value - Value to parse.
 * @param {number} defaultValue - Fallback if parsing fails.
 * @returns {number}
 */
function parseIntSafe(value, defaultValue) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

module.exports = { parseIntSafe };
