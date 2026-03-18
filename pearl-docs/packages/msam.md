## MSAM Package (`packages/msam`)

MSAM (Multi‑Stream Adaptive Memory) is a Python package that implements PearlOS’s long‑term memory system.

- **Purpose**: store, score, and retrieve memories across multiple streams (conversations, events, documents) with decay and forgetting models inspired by cognitive architectures.
- **Tech stack**: Python package with a small CLI and service helpers; built and tested outside the Node workspaces.
- **Key capabilities**:
  - Memory insertion and tagging across different content types.
  - ACT‑R‑style activation scoring to rank relevant memories.
  - Decay and forgetting over time to keep the store focused.
- **Integration**:
  - Queried by tools and services that need cross‑session or cross‑modal recall.
  - Designed to run alongside Mesh or the Pipecat bot, depending on deployment.

