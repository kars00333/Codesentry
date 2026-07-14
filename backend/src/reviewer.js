/**
 * Phase 3: LLM Review Engine.
 * Builds structured prompts and calls a self-hosted Ollama model to review code.
 */

import dotenv from "dotenv";

dotenv.config();

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";

const FINDINGS_JSON_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          lineNumber: { type: "integer" },
          category: {
            type: "string",
            enum: ["BUG", "STYLE", "SECURITY", "PERFORMANCE", "REFACTOR", "TEST_COVERAGE"],
          },
          severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
          explanation: { type: "string" },
          suggestion: { type: ["string", "null"] },
        },
        required: ["filePath", "lineNumber", "category", "severity", "explanation"],
      },
    },
  },
  required: ["findings"],
};

/**
 * Build a structured review prompt from a chunk of files.
 * Includes repo-level style config and surrounding code context if present.
 *
 * @param {Array} fileChunk - Array of parsed file objects
 * @param {string|null} repoConfig - Content of .codesentry.yml
 * @returns {string} The prompt to send to the model
 */
export function buildReviewPrompt(fileChunk, repoConfig) {
  const filesBlock = fileChunk
    .map((f) => {
      const hunksBlock = f.hunks
        .map((h) => {
          const contextBlock = h.contextSnippet
            ? `Surrounding code (from line ${h.contextStartLine}):\n\`\`\`\n${h.contextSnippet}\n\`\`\`\n\n`
            : "";
          const diffBlock = h.lines
            .map((l) => (l.type === "add" ? "+" : l.type === "del" ? "-" : " ") + l.content)
            .join("\n");
          return `${contextBlock}Diff:\n\`\`\`diff\n${diffBlock}\n\`\`\``;
        })
        .join("\n...\n");

      return `\nFile: ${f.filePath}\n${hunksBlock}\n`;
    })
    .join("\n");

  return `You are reviewing a pull request. For each issue found, respond with a JSON array of findings.

${repoConfig ? `Team style rules:\n${repoConfig}\n` : ""}

Changed files:
${filesBlock}

Respond ONLY with JSON matching this schema, no other text:
{"findings": [{
  "filePath": string,
  "lineNumber": number,
  "category": "BUG" | "STYLE" | "SECURITY" | "PERFORMANCE" | "REFACTOR" | "TEST_COVERAGE",
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "explanation": string,
  "suggestion": string | null
}]}

Only flag real issues. Do not comment on formatting already handled by a linter. Explain WHY each issue matters, not just what to change.`;
}

/**
 * Send a file chunk to the local Ollama model for review and parse the structured response.
 *
 * @param {Array} fileChunk - Array of parsed file objects
 * @param {string|null} repoConfig - Content of .codesentry.yml
 * @returns {Promise<{ findings: Array, usage: { input_tokens: number, output_tokens: number } }>}
 */
export async function reviewFileChunk(fileChunk, repoConfig) {
  const prompt = buildReviewPrompt(fileChunk, repoConfig);

  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      format: FINDINGS_JSON_SCHEMA,
      stream: false,
      options: { num_predict: 2000 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed (${res.status}): ${await res.text()}`);
  }

  const response = await res.json();

  const text = response.response ?? "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();

  // Ollama reports token counts as prompt_eval_count / eval_count.
  const usage = {
    input_tokens: response.prompt_eval_count || 0,
    output_tokens: response.eval_count || 0,
  };

  try {
    const parsed = JSON.parse(cleaned);
    // Some models still wrap or return a bare array despite the schema —
    // unwrap the first array field found, or accept a bare array directly.
    const findings = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.findings)
        ? parsed.findings
        : Object.values(parsed).find((v) => Array.isArray(v)) || [];
    // Validate the shape of each finding
    const validated = findings.filter(
      (f) =>
        f.filePath &&
        typeof f.lineNumber === "number" &&
        f.category &&
        f.severity &&
        f.explanation
    );
    return { findings: validated, usage };
  } catch {
    console.error("Failed to parse LLM response:", cleaned.substring(0, 200));
    return { findings: [], usage };
  }
}
