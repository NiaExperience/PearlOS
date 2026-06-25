import { NextResponse } from "next/server";

/**
 * /api/sessions - Query active OpenClaw sessions (including sub-agents)
 *
 * This endpoint reads from OpenClaw's session lock files to discover
 * running sessions and sub-agents.
 */

interface SessionInfo {
  sessionId: string;
  agent: string;
  label?: string;
  description?: string;
  startedAt?: string;
  isSubagent: boolean;
}

/**
 * Extract a two-sentence description from the session JSONL content.
 * Looks for the first user message and generates a readable summary.
 */
function extractDescription(content: string, label?: string): string | undefined {
  try {
    const lines = content.split("\n");
    
    // Find the first user message (contains the task instructions)
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message?.role === "user") {
          const text = typeof entry.message.content === "string"
            ? entry.message.content
            : Array.isArray(entry.message.content)
              ? entry.message.content
                  .filter((c: { type: string }) => c.type === "text")
                  .map((c: { text: string }) => c.text)
                  .join(" ")
              : "";
          
          if (!text) continue;
          
          return generateTwoSentenceSummary(text, label);
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Ignore extraction errors
  }
  return undefined;
}

/**
 * Generate a clean two-sentence summary from task instructions.
 * First sentence: What the agent is doing.
 * Second sentence: What it's investigating or building.
 */
function generateTwoSentenceSummary(taskText: string, label?: string): string {
  // Clean up the text — remove markdown, code blocks, excessive whitespace
  const cleaned = taskText
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Try to extract key phrases
  const actionLabel = label
    ? label.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : null;

  // Look for problem/requirement patterns
  const problemMatch = cleaned.match(/(?:Problem:|Issue:|Bug:|Fix:)\s*([^.!?]+[.!?]?)/i);
  const requirementMatch = cleaned.match(/(?:Requirement|Goal|Task|Implement|Build|Create|Add|Update|Fix)[\s:]+([^.!?]+[.!?]?)/i);
  const investigateMatch = cleaned.match(/(?:Investigat|Check|Debug|Analyz|Review|Audit)[\w]*[\s:]+([^.!?]+[.!?]?)/i);

  // Build first sentence (what the agent is doing)
  let sentence1: string;
  if (actionLabel) {
    sentence1 = `Working on ${actionLabel.toLowerCase()}.`;
  } else if (requirementMatch) {
    const action = requirementMatch[1].trim().replace(/[.!?]$/, "");
    sentence1 = `${action.charAt(0).toUpperCase() + action.slice(1)}.`;
  } else {
    // Fallback: extract first meaningful sentence from the text
    const firstSentence = cleaned.match(/^[^.!?]{10,120}[.!?]/);
    sentence1 = firstSentence ? firstSentence[0] : `Processing a background task.`;
  }

  // Build second sentence (what it's investigating/building)
  let sentence2: string;
  if (problemMatch) {
    const problem = problemMatch[1].trim().replace(/[.!?]$/, "");
    sentence2 = `Investigating: ${problem.toLowerCase()}.`;
  } else if (investigateMatch) {
    const investigation = investigateMatch[1].trim().replace(/[.!?]$/, "");
    sentence2 = `Looking into ${investigation.toLowerCase()}.`;
  } else if (requirementMatch && actionLabel) {
    const req = requirementMatch[1].trim().replace(/[.!?]$/, "");
    sentence2 = `${req.charAt(0).toUpperCase() + req.slice(1)}.`;
  } else {
    // Fallback: extract a meaningful chunk
    const chunk = cleaned.slice(0, 150).replace(/[^.!?]*$/, "").trim();
    sentence2 = chunk || "Analyzing the codebase and implementing changes.";
  }

  // Ensure reasonable length
  const trimSentence = (s: string, max: number) =>
    s.length > max ? s.slice(0, max - 3).replace(/\s+\S*$/, "") + "..." : s;

  return `${trimSentence(sentence1, 120)} ${trimSentence(sentence2, 120)}`;
}

export async function GET() {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");

    const basePath = "/root/.openclaw/agents";
    const sessions: SessionInfo[] = [];

    // Read all agent directories
    const agents = await fs.readdir(basePath);

    for (const agent of agents) {
      const sessionsPath = path.join(basePath, agent, "sessions");

      try {
        const files = await fs.readdir(sessionsPath);
        const jsonlFiles = files.filter(
          (f) =>
            f.endsWith(".jsonl") &&
            !f.includes(".jsonl.reset.") &&
            !f.includes(".jsonl.deleted."),
        );

        const withMtime = await Promise.all(
          jsonlFiles.map(async (f) => {
            const full = path.join(sessionsPath, f);
            const stat = await fs.stat(full);
            return { file: f, path: full, mtimeMs: stat.mtimeMs };
          }),
        );
        withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);

        for (const { file, path: jsonlPath } of withMtime) {
          const sessionId = file.replace(/\.jsonl$/, "");

          try {
            const content = await fs.readFile(jsonlPath, "utf-8");
            const firstLine = content.split("\n")[0];
            const sessionData = JSON.parse(firstLine);

            const isSubagent =
              sessionId.includes("subagent") ||
              sessionData.label?.includes("subagent") ||
              false;

            let description: string | undefined;
            if (isSubagent) {
              description = extractDescription(content, sessionData.label);
            }

            sessions.push({
              sessionId,
              agent,
              label: sessionData.label || undefined,
              description,
              startedAt: sessionData.timestamp || undefined,
              isSubagent,
            });
          } catch (err) {
            console.warn(`Failed to read session ${sessionId}:`, err);
          }
        }
      } catch {
        continue;
      }
    }

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Failed to query sessions:", error);
    return NextResponse.json(
      { error: "Failed to query sessions" },
      { status: 500 }
    );
  }
}
