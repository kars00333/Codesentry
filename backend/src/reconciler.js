/**
 * Phase 4b: Reconcile findings across re-runs.
 * Without this, every synchronize event re-reviews the whole diff
 * and re-posts duplicate comments on issues that are still there.
 *
 * Strategy:
 * 1. Fetch existing findings for this PR from DB
 * 2. Run the new review
 * 3. Diff old vs new findings — mark resolved ones, only post genuinely new ones
 *
 * Uses ±3 line proximity matching (intentionally simple, because line numbers
 * shift as code changes above the finding).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Compare new findings against previous review's findings.
 * Marks resolved findings and returns only genuinely new ones to post.
 *
 * @param {string} reviewId - Current review ID
 * @param {string} repoId - Repository ID
 * @param {number} prNumber - PR number
 * @param {Array} newFindings - New findings from LLM
 * @returns {Promise<Array>} Findings that should be posted (genuinely new)
 */
export async function reconcileFindings(
  reviewId,
  repoId,
  prNumber,
  newFindings
) {
  const previousReview = await prisma.review.findFirst({
    where: { repoId, prNumber, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    include: { findings: true },
  });

  const previousOpen =
    previousReview?.findings.filter((f) => !f.resolved) ?? [];

  // Simple key: filePath + category + rough line proximity
  const stillPresent = new Set();
  for (const old of previousOpen) {
    const match = newFindings.find(
      (f) =>
        f.filePath === old.filePath &&
        f.category === old.category &&
        Math.abs(f.lineNumber - old.lineNumber) <= 3
    );
    if (match) {
      stillPresent.add(match);
      match._matchedOldId = old.id; // Don't repost, just carry forward
    }
  }

  // Mark findings that are no longer present as resolved
  const resolvedIds = previousOpen
    .filter((f) => {
      const match = newFindings.find(
        (nf) =>
          nf.filePath === f.filePath &&
          nf.category === f.category &&
          Math.abs(nf.lineNumber - f.lineNumber) <= 3
      );
      return !match;
    })
    .map((f) => f.id);

  if (resolvedIds.length > 0) {
    await prisma.finding.updateMany({
      where: { id: { in: resolvedIds } },
      data: { resolved: true },
    });
  }

  // Only post findings that weren't matched to existing ones
  const toPost = newFindings.filter((f) => !stillPresent.has(f));
  return toPost;
}
