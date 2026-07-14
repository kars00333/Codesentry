/**
 * BullMQ Worker: Orchestrates the full review pipeline.
 * Processes review-pr jobs from the queue.
 *
 * Pipeline: fetch diff → parse → chunk → review (LLM) → reconcile → post → store
 */

import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import dotenv from "dotenv";

import { getInstallationOctokit } from "./auth.js";
import { parsePRDiff } from "./diff-parser.js";
import { getFileContext } from "./context-builder.js";
import { chunkFilesByBudget } from "./chunker.js";
import { reviewFileChunk } from "./reviewer.js";
import { reconcileFindings } from "./reconciler.js";
import { submitReview } from "./github-review.js";
import { estimateCost } from "./utils.js";

dotenv.config();

const prisma = new PrismaClient();
const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

/**
 * Process a review-pr job.
 */
async function processReview(job) {
  const { installationId, repoFullName, prNumber, headSha, prTitle } = job.data;
  const [owner, repo] = repoFullName.split("/");

  console.log(`🔍 Starting review for ${repoFullName}#${prNumber} (${headSha.slice(0, 7)})`);

  // Find or create repo record
  let repoRecord = await prisma.repo.findFirst({
    where: { fullName: repoFullName },
  });

  if (!repoRecord) {
    // Auto-create repo record if it doesn't exist yet
    let installation = await prisma.installation.findFirst({
      where: { githubInstallId: BigInt(installationId) },
    });

    if (!installation) {
      installation = await prisma.installation.create({
        data: {
          githubInstallId: BigInt(installationId),
          accountLogin: owner,
          accountType: "Organization",
        },
      });
    }

    repoRecord = await prisma.repo.create({
      data: {
        installationId: installation.id,
        githubRepoId: BigInt(0), // Will be updated later
        fullName: repoFullName,
      },
    });
  }

  // Create review record
  const review = await prisma.review.create({
    data: {
      repoId: repoRecord.id,
      prNumber,
      prTitle: prTitle || `PR #${prNumber}`,
      headSha,
      status: "RUNNING",
    },
  });

  try {
    const octokit = await getInstallationOctokit(installationId);

    // Fetch the PR diff
    const { data: diffText } = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      { owner, repo, pull_number: prNumber, mediaType: { format: "diff" } }
    );

    // Parse the diff
    const parsedFiles = parsePRDiff(diffText);

    if (parsedFiles.length === 0) {
      console.log("No reviewable files in diff, skipping.");
      await prisma.review.update({
        where: { id: review.id },
        data: { status: "COMPLETED", completedAt: new Date(), tokensUsed: 0 },
      });
      return;
    }

    // Fetch surrounding code context for each hunk so the LLM sees more
    // than the bare diff fragment
    for (const file of parsedFiles) {
      if (file.isDeleted) continue;
      for (const hunk of file.hunks) {
        const { snippet, snippetStartLine } = await getFileContext(
          octokit,
          owner,
          repo,
          file.filePath,
          headSha,
          hunk
        );
        hunk.contextSnippet = snippet;
        hunk.contextStartLine = snippetStartLine;
      }
    }

    // Chunk files by token budget
    const chunks = chunkFilesByBudget(parsedFiles);

    // Fetch repo config (.codesentry.yml)
    let repoConfig = repoRecord.configYaml;
    if (!repoConfig) {
      try {
        const { data } = await octokit.request(
          "GET /repos/{owner}/{repo}/contents/{path}",
          { owner, repo, path: ".codesentry.yml", ref: headSha }
        );
        repoConfig = Buffer.from(data.content, "base64").toString("utf-8");
        // Cache it
        await prisma.repo.update({
          where: { id: repoRecord.id },
          data: { configYaml: repoConfig },
        });
      } catch {
        // No config file, that's fine
      }
    }

    // Review each chunk via LLM
    const allFindings = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let i = 0; i < chunks.length; i++) {
      console.log(`  📄 Reviewing chunk ${i + 1}/${chunks.length} (${chunks[i].length} files)`);
      const { findings, usage } = await reviewFileChunk(chunks[i], repoConfig);
      allFindings.push(...findings);
      totalInputTokens += usage.input_tokens;
      totalOutputTokens += usage.output_tokens;
    }

    const totalTokens = totalInputTokens + totalOutputTokens;
    const cost = estimateCost(totalInputTokens, totalOutputTokens);

    console.log(`  🔎 Found ${allFindings.length} issues (${totalTokens} tokens, $${cost.toFixed(4)})`);

    // Reconcile with previous findings
    const toPost = await reconcileFindings(review.id, repoRecord.id, prNumber, allFindings);

    console.log(`  📝 Posting ${toPost.length} new findings (${allFindings.length - toPost.length} already known)`);

    // Post review to GitHub
    const result = await submitReview(octokit, owner, repo, prNumber, headSha, toPost);

    // Store findings in DB
    if (toPost.length > 0) {
      await prisma.finding.createMany({
        data: toPost.map((f) => ({
          reviewId: review.id,
          filePath: f.filePath,
          lineNumber: f.lineNumber,
          category: f.category,
          severity: f.severity,
          explanation: f.explanation,
          suggestion: f.suggestion || null,
          githubCommentId: null,
        })),
      });
    }

    // Update review as completed
    await prisma.review.update({
      where: { id: review.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        tokensUsed: totalTokens,
        costUsd: cost,
      },
    });

    console.log(`  ✅ Review complete for ${repoFullName}#${prNumber}`);
  } catch (error) {
    console.error(`  ❌ Review failed for ${repoFullName}#${prNumber}:`, error);
    await prisma.review.update({
      where: { id: review.id },
      data: { status: "FAILED", completedAt: new Date() },
    });
    throw error;
  }
}

// Start the worker
const worker = new Worker("review-queue", processReview, {
  connection,
  concurrency: 3,
  limiter: {
    max: 10,
    duration: 60000, // Max 10 jobs per minute
  },
});

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});

worker.on("ready", () => {
  console.log("🚀 Codesentry worker ready and listening for jobs...");
});

console.log("🤖 Codesentry worker starting...");
