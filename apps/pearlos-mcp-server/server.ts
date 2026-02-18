#!/usr/bin/env npx tsx
/**
 * PearlOS MCP Server v2
 *
 * Exposes PearlOS bot tools as MCP tools for OpenClaw.
 * Uses synchronous REST endpoints where available (notes CRUD),
 * falls back to Daily app-message relay for UI-only tools.
 *
 * Architecture:
 *   OpenClaw → MCP → this server → Bot Gateway REST API → Mesh/Daily → PearlOS UI
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BOT_GATEWAY_URL =
  process.env.PEARLOS_BOT_GATEWAY_URL || "http://localhost:4444";

// ---------------------------------------------------------------------------
// Tool definitions from bot gateway
// ---------------------------------------------------------------------------

interface BotTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  feature_flag?: string;
  passthrough?: boolean;
}

let cachedTools: BotTool[] | null = null;

async function fetchTools(): Promise<BotTool[]> {
  if (cachedTools) return cachedTools;
  const resp = await fetch(`${BOT_GATEWAY_URL}/api/tools/list`);
  if (!resp.ok) throw new Error(`Failed to fetch tools: ${resp.status}`);
  const data = await resp.json() as { tools: BotTool[]; count: number };
  cachedTools = data.tools;
  console.error(`[pearlos-mcp] Loaded ${data.count} tools from bot gateway`);
  return cachedTools;
}

// ---------------------------------------------------------------------------
// Synchronous REST handlers for notes tools
// ---------------------------------------------------------------------------

const NOTES_REST_HANDLERS: Record<
  string,
  (params: Record<string, unknown>) => Promise<unknown>
> = {
  bot_list_notes: async () => {
    const resp = await fetch(`${BOT_GATEWAY_URL}/api/notes`);
    return resp.json();
  },

  bot_create_note: async (params) => {
    const resp = await fetch(`${BOT_GATEWAY_URL}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: params.title || "Untitled",
        content: params.content || "",
        mode: params.mode || "personal",
      }),
    });
    return resp.json();
  },

  bot_read_current_note: async (params) => {
    const noteId = params.note_id as string;
    if (!noteId) {
      // List notes and return the first one
      const resp = await fetch(`${BOT_GATEWAY_URL}/api/notes`);
      const data = (await resp.json()) as { notes: Array<{ _id: string }> };
      if (!data.notes?.length) return { error: "No notes found" };
      const first = data.notes[0];
      const detailResp = await fetch(
        `${BOT_GATEWAY_URL}/api/notes/${first._id}`
      );
      return detailResp.json();
    }
    const resp = await fetch(`${BOT_GATEWAY_URL}/api/notes/${noteId}`);
    return resp.json();
  },

  bot_replace_note: async (params) => {
    const noteId = params.note_id as string;
    if (!noteId) return { error: "note_id required for replace" };
    const resp = await fetch(`${BOT_GATEWAY_URL}/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: params.content,
        title: params.title,
      }),
    });
    return resp.json();
  },

  bot_add_note_content: async (params) => {
    const noteId = params.note_id as string;
    if (!noteId) return { error: "note_id required for append" };
    const resp = await fetch(
      `${BOT_GATEWAY_URL}/api/notes/${noteId}/append`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: params.content,
          position: params.position || "end",
        }),
      }
    );
    return resp.json();
  },

  bot_delete_note: async (params) => {
    const noteId = params.note_id as string;
    if (!noteId) return { error: "note_id required for delete" };
    const resp = await fetch(`${BOT_GATEWAY_URL}/api/notes/${noteId}`, {
      method: "DELETE",
    });
    return resp.json();
  },

  bot_search_wikipedia: async (params) => {
    // Pass through to execute endpoint
    return executeToolSync("bot_search_wikipedia", params);
  },
};

// ---------------------------------------------------------------------------
// Synchronous execute endpoint (for tools that support it)
// ---------------------------------------------------------------------------

async function executeToolSync(
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const resp = await fetch(`${BOT_GATEWAY_URL}/api/tools/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool_name: toolName, params }),
  });
  return resp.json();
}

// ---------------------------------------------------------------------------
// Async invoke (Daily app-message relay) for UI-only tools
// ---------------------------------------------------------------------------

async function invokeToolAsync(
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const resp = await fetch(`${BOT_GATEWAY_URL}/api/tools/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool_name: toolName, params }),
  });
  return resp.json();
}

// ---------------------------------------------------------------------------
// Smart tool dispatcher
// ---------------------------------------------------------------------------

async function callTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; sync: boolean }> {
  // 1. Check if we have a synchronous REST handler
  if (NOTES_REST_HANDLERS[toolName]) {
    const result = await NOTES_REST_HANDLERS[toolName](params);
    return { result, sync: true };
  }

  // 2. Try the synchronous execute endpoint
  try {
    const resp = await fetch(`${BOT_GATEWAY_URL}/api/tools/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_name: toolName, params }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.success !== false && !data.detail?.includes("not supported")) {
        return { result: data, sync: true };
      }
    }
  } catch {
    // Fall through to async
  }

  // 3. Fall back to async Daily relay
  const result = await invokeToolAsync(toolName, params);
  return { result, sync: false };
}

// ---------------------------------------------------------------------------
// MCP tool schema conversion
// ---------------------------------------------------------------------------

function botToolToMcp(tool: BotTool) {
  let inputSchema: Record<string, unknown> = {
    type: "object" as const,
    properties: {},
  };

  if (tool.parameters) {
    if (tool.parameters.type === "object" && tool.parameters.properties) {
      inputSchema = tool.parameters;
    } else if (
      Object.keys(tool.parameters).length > 0 &&
      !tool.parameters.type
    ) {
      inputSchema = { type: "object", properties: tool.parameters };
    }
  }

  return {
    name: tool.name,
    description: tool.description || `PearlOS tool: ${tool.name}`,
    inputSchema,
  };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "pearlos", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await fetchTools();
  return {
    tools: tools
      .filter((t) => t.name !== "bot_openclaw_task") // prevent recursion
      .map(botToolToMcp),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const { result, sync } = await callTool(
      name,
      (args as Record<string, unknown>) || {}
    );

    const text = sync
      ? JSON.stringify(result, null, 2)
      : JSON.stringify(
          {
            delivered: true,
            tool: name,
            note: "Tool executed asynchronously. UI will update in PearlOS.",
            ...(result as Record<string, unknown>),
          },
          null,
          2
        );

    return {
      content: [{ type: "text" as const, text }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[pearlos-mcp] MCP server v2 running on stdio");
  console.error(`[pearlos-mcp] Bot gateway: ${BOT_GATEWAY_URL}`);
}

main().catch((err) => {
  console.error("[pearlos-mcp] Fatal:", err);
  process.exit(1);
});
