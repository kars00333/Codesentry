/**
 * GitHub App authentication module.
 * Handles JWT generation and installation token flow.
 */

import { App } from "@octokit/app";
import dotenv from "dotenv";

dotenv.config();

// The GitHub App is only constructed on first use, not at module load —
// GITHUB_APP_ID is optional (e.g. running the dashboard against demo data
// without a GitHub App configured yet), and eagerly constructing it here
// would crash the whole process before any job is even processed.
let githubApp;

function getGithubApp() {
  if (!githubApp) {
    if (!process.env.GITHUB_APP_ID) {
      throw new Error(
        "GITHUB_APP_ID is not set. Configure your GitHub App credentials in .env before reviewing real pull requests."
      );
    }
    githubApp = new App({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      webhooks: { secret: process.env.WEBHOOK_SECRET },
    });
  }
  return githubApp;
}

/**
 * Get an authenticated Octokit instance for a specific installation.
 * Uses the GitHub App JWT → installation token flow.
 * @param {number} installationId - GitHub installation ID
 * @returns {Promise<import('@octokit/rest').Octokit>}
 */
export async function getInstallationOctokit(installationId) {
  return getGithubApp().getInstallationOctokit(installationId);
}
