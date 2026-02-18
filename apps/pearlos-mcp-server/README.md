# PearlOS MCP Server

Exposes PearlOS bot tools (notes, YouTube, window management, apps, etc.) as MCP (Model Context Protocol) tools that OpenClaw can call directly.

## Architecture

```
User Voice → Deepgram STT → Pipecat → OpenClaw (single LLM)
                                          ↓
                                    MCP Tool Call
                                          ↓
                              PearlOS MCP Server (this)
                                          ↓
                              Daily.co app-message → UI
```

## How It Works

1. OpenClaw connects to this MCP server via stdio or HTTP
2. When the LLM decides to use a PearlOS tool (e.g. `bot_create_note`), OpenClaw sends the MCP tool call here
3. This server translates the MCP call into a Daily.co app-message event
4. The PearlOS frontend receives the event and executes the action
5. Results flow back through the same path

## Running

```bash
npx tsx server.ts
```

## Tools Exposed

All 68+ PearlOS bot tools are auto-discovered from the Python tool definitions.
