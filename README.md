<<<<<<< HEAD
# 🛡️ Codesentry — AI-Powered GitHub PR Code Review
=======
#  Codesentry — AI-Powered GitHub PR Code Review
>>>>>>> e1c4342768c0ed3a45aa4885c76edeff37b462fd

Codesentry is a GitHub App that automatically reviews pull requests using a self-hosted LLM via Ollama. It catches bugs, security vulnerabilities, style violations, and performance issues, posting inline comments directly on your PRs.

## How developers actually use this

There's no new tool to learn and nothing to install locally for day-to-day use. Once Codesentry is installed on a repo:

1. Write code in whatever editor you already use, push, and open a pull request as normal.
2. Codesentry's findings show up as regular inline comments on GitHub's own **"Files changed"** tab — the same place a human reviewer's comments would appear.
3. Where the model has a concrete fix, the comment includes GitHub's native suggested-change block, which renders as a one-click **"Commit suggestion"** button — click it and GitHub commits the fix for you. No suggestion, no button — just read the explanation and fix it yourself.
4. Everything else (findings with no one-click fix) you address the same way you'd address any human reviewer's comment.

Everything from here down is for whoever is setting Codesentry up (self-hosting it), not for developers who just get reviewed.

## Architecture

```
PR opened → GitHub webhook → Express server → BullMQ queue → Worker:
  1. Fetch PR diff via GitHub API
  2. Parse diff into structured hunks
  3. Fetch surrounding code context for each hunk
  4. Chunk files by token budget
  5. Send to local Ollama model for review
  6. Reconcile with previous findings
  7. Post inline review comments
  8. Store results in Postgres
```

## Tech Stack

- **Backend**: Node.js, Express, Prisma (Postgres), BullMQ (Redis)
- **AI**: Self-hosted LLM via [Ollama](https://ollama.com) (default model: `qwen2.5-coder:7b`)
- **GitHub**: GitHub App with Octokit

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis (for BullMQ job queue)
- [Ollama](https://ollama.com) with a code-capable model pulled (e.g. `qwen2.5-coder:7b`)
- GitHub App credentials (see Step 4 below)

## Quick Start

### 1. Local services setup

Codesentry needs Postgres, Redis, and Ollama running locally. On macOS with Homebrew:

```bash
brew install postgresql@16 redis ollama

# Start them (each in its own terminal, or via `brew services start <name>`)
postgres -D /opt/homebrew/var/postgresql@16
redis-server
ollama serve

# One-time setup
createdb codesentry
ollama pull qwen2.5-coder:7b   # ~4.7GB download
```

On Linux, install the equivalents via your package manager (`apt install postgresql redis-server`, and see [ollama.com/download](https://ollama.com/download)), then run the same `createdb`/`ollama pull` steps.

### 2. Clone and install

```bash
cd backend
cp .env.example .env
# DATABASE_URL/REDIS_URL/OLLAMA_* defaults in .env.example already match step 1 above —
# no edits needed unless you changed a port or DB name.
npm install
npx prisma db push
```

### 3. Set up GitHub App

1. Go to [github.com/settings/apps/new](https://github.com/settings/apps/new)
2. Set webhook URL to your server (use ngrok for local dev, e.g. `ngrok http 3001`)
3. Permissions: Pull requests (Read & Write), Contents (Read), Metadata (Read)
4. Subscribe to events: `pull_request`, `installation`
5. Generate a private key (.pem)
6. Copy App ID, Private Key, and Webhook Secret into `.env`
7. Install the App on the repo(s) you want reviewed

### 4. Run

```bash
# Terminal 1: Backend server (receives the GitHub webhook)
cd backend
npm run dev

# Terminal 2: Background worker (runs the actual review pipeline)
cd backend
npm run worker
```

- **Webhook**: http://localhost:3001/webhooks/github
- **Health check**: http://localhost:3001/api/health

Open a pull request on a repo with the App installed — Codesentry fetches the diff, reviews it with your local Ollama model, and posts inline comments automatically.

## Project Structure

```
codesentry/
├── backend/
│   ├── prisma/schema.prisma    # Database schema
│   ├── src/
│   │   ├── index.js            # Express server + webhook handler
│   │   ├── auth.js             # GitHub App JWT auth
│   │   ├── diff-parser.js      # Parse unified diffs
│   │   ├── context-builder.js  # Fetch surrounding code context
│   │   ├── chunker.js          # Token budget chunking
│   │   ├── reviewer.js         # Ollama LLM integration
│   │   ├── github-review.js    # Post inline review comments
│   │   ├── reconciler.js       # Dedup findings across re-runs
│   │   ├── worker.js           # BullMQ worker
│   │   └── utils.js            # Helper functions
│   └── .env.example
```

## Features

- ✅ GitHub App with webhook verification
- ✅ Unified diff parsing with file filtering
- ✅ Token-budget aware chunking for large PRs
- ✅ Self-hosted LLM code review (Ollama) with structured output
- ✅ Batched inline review comments (not spam)
- ✅ Smart re-run handling (±3 line proximity dedup)
- ✅ Token usage tracking per review (no per-token API cost — runs locally)
- ✅ Per-repo `.codesentry.yml` configuration

## License

MIT
