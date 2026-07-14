/**
 * Codesentry Backend — Express Server
 *
 * Handles:
 * - GitHub webhook endpoint (POST /webhooks/github)
 * - Webhook signature verification
 */

import express from "express";
import crypto from "crypto";
import { Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// Redis connection for BullMQ
const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// Job queue
const reviewQueue = new Queue("review-queue", { connection });

// Parse JSON with raw body preserved for webhook signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ─── Webhook Signature Verification ───────────────────────────────────
function verifySignature(req) {
  const sig = req.headers["x-hub-signature-256"];
  if (!sig || !process.env.WEBHOOK_SECRET) return false;
  const hmac = crypto.createHmac("sha256", process.env.WEBHOOK_SECRET);
  const digest = "sha256=" + hmac.update(req.rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest));
  } catch {
    return false;
  }
}

// ─── GitHub Webhook Endpoint ──────────────────────────────────────────
app.post("/webhooks/github", async (req, res) => {
  // Verify webhook signature
  if (process.env.NODE_ENV === "production" && !verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = req.headers["x-github-event"];
  const payload = req.body;

  // Respond fast — GitHub times out around 10s
  res.status(200).json({ received: true });

  try {
    if (
      event === "pull_request" &&
      ["opened", "synchronize"].includes(payload.action)
    ) {
      console.log(
        `📥 PR ${payload.action}: ${payload.repository.full_name}#${payload.pull_request.number}`
      );
      await reviewQueue.add("review-pr", {
        installationId: payload.installation.id,
        repoFullName: payload.repository.full_name,
        prNumber: payload.pull_request.number,
        prTitle: payload.pull_request.title,
        headSha: payload.pull_request.head.sha,
      });
    }

    if (event === "installation" && payload.action === "created") {
      console.log(
        `🔧 App installed on ${payload.installation.account.login}`
      );
      // Store installation record
      await prisma.installation.upsert({
        where: { githubInstallId: BigInt(payload.installation.id) },
        update: {},
        create: {
          githubInstallId: BigInt(payload.installation.id),
          accountLogin: payload.installation.account.login,
          accountType: payload.installation.account.type,
        },
      });
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
  }
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Start Server ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Codesentry server running on port ${PORT}`);
  console.log(`   Webhook URL: http://localhost:${PORT}/webhooks/github`);
});
