## NCP Service (`apps/ncp`)

The Nia Context Protocol (NCP) service is a Python FastAPI backend that provides structured context data (agendas, speakers, exhibitors, keyword lookups) to PearlOS.

- **Purpose**: serve curated event and context data over HTTP so assistants can answer detailed questions about schedules, talks, and participants.
- **Tech stack**: Python, FastAPI, Pydantic, SQL or in‑memory backing store depending on deployment.
- **Structure**:
  - `ncp/`: FastAPI application package with routers and services.
  - `services/`: domain services such as `agenda_service` and `exhibitor_service`.
  - `requirements.txt`: Python dependencies.
- **Integration**:
  - Queried by tools in the Pipecat bot and/or Interface via HTTP.
  - Designed as a separate microservice that can evolve independently of the main monorepo.

