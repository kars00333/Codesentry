/**
 * Phase 2, Step 2: Fetch surrounding code context.
 * Changed lines alone aren't enough — the LLM needs to see the function
 * a change lives in, not just the diff fragment.
 */

/**
 * Fetch the full file at a specific commit SHA and expand hunks by N lines
 * to provide surrounding context for the LLM.
 *
 * @param {import('@octokit/rest').Octokit} octokit - Authenticated Octokit instance
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {string} path - File path
 * @param {string} sha - Commit SHA
 * @param {Object} hunk - Hunk object with startLine and lines
 * @param {number} contextLines - Number of surrounding lines to include (default: 15)
 * @returns {Promise<{ snippet: string, snippetStartLine: number }>}
 */
export async function getFileContext(
  octokit,
  owner,
  repo,
  path,
  sha,
  hunk,
  contextLines = 15
) {
  try {
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      { owner, repo, path, ref: sha }
    );

    const fullFile = Buffer.from(data.content, "base64").toString("utf-8");
    const lines = fullFile.split("\n");

    const start = Math.max(0, hunk.startLine - contextLines);
    const end = Math.min(
      lines.length,
      hunk.startLine + hunk.lines.length + contextLines
    );

    return {
      snippet: lines.slice(start, end).join("\n"),
      snippetStartLine: start + 1,
    };
  } catch (error) {
    // File might not exist (deleted), or be too large
    console.warn(`Could not fetch context for ${path}:`, error.message);
    return {
      snippet: "",
      snippetStartLine: 0,
    };
  }
}
