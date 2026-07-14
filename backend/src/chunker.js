/**
 * Phase 2, Step 3: Handle large PRs via token-budget chunking.
 * This is the part that demonstrates AI-infra thinking:
 * - Small PR: send everything in one call
 * - Large PR: process file-by-file with map-reduce strategy
 */

import { estimateTokens } from "./utils.js";

// Rough budget for diff+context, leaving room for response
const TOKEN_BUDGET_PER_CALL = 6000;

/**
 * Group parsed files into chunks that fit within the token budget.
 * Each chunk will be sent as a single LLM call.
 *
 * @param {Array} parsedFiles - Array of parsed file objects from parsePRDiff
 * @returns {Array<Array>} Array of file chunks
 */
export function chunkFilesByBudget(parsedFiles) {
  const chunks = [];
  let current = [];
  let currentTokens = 0;

  for (const file of parsedFiles) {
    const estTokens = estimateTokens(file);
    if (currentTokens + estTokens > TOKEN_BUDGET_PER_CALL && current.length) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(file);
    currentTokens += estTokens;
  }

  if (current.length) chunks.push(current);
  return chunks;
}
