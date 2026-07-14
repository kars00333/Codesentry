/**
 * Utility functions used across the Codesentry backend.
 */

/**
 * Group an array of objects by a given key.
 * @param {Array} arr - Array of objects
 * @param {string} key - Property name to group by
 * @returns {Object} Grouped object
 */
export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const group = item[key];
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {});
}

/**
 * Rough token estimate: ~4 characters per token.
 * Used for budgeting LLM context window usage.
 * @param {Object} file - Parsed file object with hunks
 * @returns {number} Estimated token count
 */
export function estimateTokens(file) {
  const content = JSON.stringify(file);
  return Math.ceil(content.length / 4);
}

/**
 * Check if a file path is a binary or lockfile that should be skipped.
 * @param {string} path - File path
 * @returns {boolean}
 */
export function isBinaryOrLockfile(path) {
  const skip = [
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /\.png$/,
    /\.jpg$/,
    /\.jpeg$/,
    /\.gif$/,
    /\.svg$/,
    /\.ico$/,
    /\.woff2?$/,
    /\.ttf$/,
    /\.eot$/,
    /\.min\.js$/,
    /\.min\.css$/,
    /\.map$/,
    /\.pdf$/,
    /\.zip$/,
    /\.tar\.gz$/,
    /\.wasm$/,
  ];
  return skip.some((re) => re.test(path ?? ""));
}

/**
 * Calculate estimated cost in USD based on token usage.
 * Self-hosted Ollama inference has no per-token API cost.
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} Cost in USD
 */
export function estimateCost(inputTokens, outputTokens) {
  return 0;
}

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
