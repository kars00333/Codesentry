/**
 * Phase 2, Step 1: Parse unified diffs into structured hunks.
 * Uses the parse-diff npm package to avoid hand-rolling a diff parser.
 */

import parseDiff from "parse-diff";
import { isBinaryOrLockfile } from "./utils.js";

/**
 * Parse a raw unified diff string into structured file/hunk objects.
 * Filters out binary files and lockfiles.
 *
 * @param {string} diffText - Raw unified diff from GitHub API
 * @returns {Array<{
 *   filePath: string,
 *   isNew: boolean,
 *   isDeleted: boolean,
 *   hunks: Array<{
 *     startLine: number,
 *     lines: Array<{
 *       type: 'add' | 'del' | 'normal',
 *       content: string,
 *       lineNumber: number
 *     }>
 *   }>
 * }>}
 */
export function parsePRDiff(diffText) {
  const files = parseDiff(diffText);

  return files
    .filter((f) => !isBinaryOrLockfile(f.to))
    .map((f) => ({
      filePath: f.to,
      isNew: f.new,
      isDeleted: f.deleted,
      hunks: f.chunks.map((chunk) => ({
        startLine: chunk.newStart,
        lines: chunk.changes.map((c) => ({
          type: c.type, // "add" | "del" | "normal"
          content: c.content,
          lineNumber: c.ln ?? c.ln2,
        })),
      })),
    }));
}
