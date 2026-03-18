## PearlOS MCP Server (`apps/pearlos-mcp-server`)

The PearlOS MCP server exposes PearlOS tools over the Model Context Protocol so external orchestrators (such as OpenClaw) can control Pearl’s capabilities.

- **Purpose**: bridge PearlOS’s internal tool surface into a generic MCP tool catalog, enabling agents outside the monorepo to invoke actions.
- **Tech stack**: Node.js, TypeScript, `@modelcontextprotocol/sdk`, `tsx` for dev.
- **Structure**:
  - `server.ts`: main MCP server entrypoint (stdio transport).
  - `pearlos-tool/`: support for running PearlOS tool invocations from the MCP side.
- **Integration**:
  - Reads tool descriptors and forwards invocations into the existing PearlOS backend stack.
  - Designed to run as a sidecar process alongside the main apps.

