/**
 * Phase 4a: Post inline review comments via GitHub's Review API.
 * Submits a single batched review (not spamming individual comments).
 */

import { groupBy } from "./utils.js";

/**
 * Submit a batched review with inline comments to a PR.
 *
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 * @param {string} headSha
 * @param {Array} findings - Array of finding objects
 * @returns {Promise<Object|void>} Review data from GitHub
 */
export async function submitReview(
  octokit,
  owner,
  repo,
  prNumber,
  headSha,
  findings
) {
  if (findings.length === 0) {
    // Post a short "looks good" summary
    await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        owner,
        repo,
        pull_number: prNumber,
        commit_id: headSha,
        event: "COMMENT",
        body: "✅ No issues found in this PR. Nice work!",
      }
    );
    return;
  }

  const hasCritical = findings.some((f) => f.severity === "CRITICAL");

  const comments = findings.map((f) => ({
    path: f.filePath,
    line: f.lineNumber,
    body: formatFindingComment(f),
  }));

  const { data } = await octokit.request(
    "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    {
      owner,
      repo,
      pull_number: prNumber,
      commit_id: headSha,
      event: hasCritical ? "REQUEST_CHANGES" : "COMMENT",
      body: buildReviewSummary(findings),
      comments,
    }
  );

  return data;
}

/**
 * Format a single finding as a GitHub review comment.
 * Uses emoji severity badges and GitHub's suggestion code block format.
 */
export function formatFindingComment(f) {
  const emoji = { CRITICAL: "🔴", HIGH: "🟠", MEDIUM: "🟡", LOW: "⚪" }[
    f.severity
  ];
  let body = `${emoji} **${f.category}**\n\n${f.explanation}`;
  if (f.suggestion) {
    body += `\n\n**Suggestion:**\n\`\`\`suggestion\n${f.suggestion}\n\`\`\``;
  }
  return body;
}

/**
 * Build a summary body for the review with counts by severity.
 */
export function buildReviewSummary(findings) {
  const bySeverity = groupBy(findings, "severity");
  const lines = ["**🤖 Codesentry Summary**", ""];
  for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
    if (bySeverity[sev])
      lines.push(`- ${bySeverity[sev].length} ${sev.toLowerCase()}`);
  }
  lines.push(
    "",
    `_${findings.length} issue${findings.length === 1 ? "" : "s"} found across ${new Set(findings.map((f) => f.filePath)).size} file${new Set(findings.map((f) => f.filePath)).size === 1 ? "" : "s"}_`
  );
  return lines.join("\n");
}
