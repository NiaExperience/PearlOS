# Technology Stack

## Core Platform
*   **Monorepo Management:** NPM Workspaces
*   **Languages:** TypeScript (Primary), Python (Voice & AI Services)
*   **UI Framework:** Next.js (App Router), React
*   **Animation/Avatars:** Rive (Reactive state machines)

## Data & Backend
*   **Data Abstraction:** Prism (Multi-source provider bridge)
*   **API Layer:** GraphQL Mesh (Unified GraphQL endpoint)
*   **Server Frameworks:** Express (Node.js), FastAPI (Python)
*   **Primary Database:** PostgreSQL
*   **Caching/Messaging:** Redis

## Conversational AI & Voice
*   **Transport & STT:** Daily.co (WebRTC with integrated Transcription/STT)
*   **Pipeline:** Pipecat AI (receiving transcriptions from Daily)
*   **Text-to-Speech (TTS):** ElevenLabs, Kokoro (Chorus TTS)

## Infrastructure & DevOps
*   **Local Development:** Tilt, Docker
*   **Orchestration:** Kubernetes (Helm charts)
*   **Continuous Deployment:** FluxCD (In‑progress implementation)
*   **Monitoring & Alerting:** AWS CloudWatch
*   **CI:** GitHub Actions
