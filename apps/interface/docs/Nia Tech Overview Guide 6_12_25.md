Nia-Universal Codebase – Comprehensive Orientation Guide  
========================================================

This guide maps out every moving piece in the repository so that a new contributor can see how the product hangs together, where to look for specific behaviour, and how to spin up or deploy each part.  It cross-links the most important reference documents that already live in the repo (anything under `docs/VIVI` is intentionally ignored).

-------------------------------------------------------------------
1. Product & High-Level Architecture
-------------------------------------------------------------------

Nia-Universal delivers "front-of-house" AI assistants that greet hotel guests, conference delegates, and cruise-ship passengers through voice, text, and (experimental) AR surfaces.  
At runtime the system is composed of four tiers:

1. Client Tier  
   • Browser (Next.js App Router)  
   • WebXR / WebTransport streaming for voice  
2. Edge API Tier  
   • Next.js API routes (serverless on Vercel)  
3. Context Tier ("NCP")  
   • FastAPI micro-service that fetches, munges, and caches event / venue data  
4. Core Agent Tier  
   • Python chat engine that calls Groq/OpenAI models, Twilio, etc.

Data flow (simplified):

```
Guest → Interface (Next.js) ──REST/WS──► NCP ──HTTP──► Interface API
      ↑                                         │
      └──WebTransport/LLM stream◄──Chat Agent◄──┘
```

-------------------------------------------------------------------
2. Repository Layout
-------------------------------------------------------------------

| Path | Purpose |
|------|---------|
| `apps/interface` | Voice & multimodal web client ("Project Pearl v2"). Serves all public UI, audio streaming, and exposes lightweight `/api/*` routes used by NCP. |
| `apps/dashboard` | Admin UI for creating / styling / deploying assistants. Runs on `:4000` in dev. |
| `apps/ncp` | "Nia Context Protocol" – FastAPI server that normalises event data and provides semantic helper endpoints (`/showAgenda`, `/keywordMemoryLookup`, …). |
| `packages/core/nia-chat-agent` | Main conversational engine. Includes FastAPI API (`api_server.py`), function-calling utilities, Twilio integration, and a small toolchain (`functions/`, `utils/`). |
| `packages/core/nia-py-server` | Very slim Flask relay that can listen to 3rd-party webhooks (e.g. VAPI) and forward transcripts into MongoDB. |
| `scripts/` | Repository automation (e.g. `setup-env.mjs` copies `.env.example` files). |
| `CODEBASE_GUIDE.md` | Living doc – this guide (supersedes the earlier stub). |
| `README.md` + each app's `README` | Quick-start commands and troubleshooting. |
| `apps/interface/docs/*` | Design documents, product roadmaps, and architecture diagrams. (**NOTE**: everything in `docs/VIVI` is out of scope). |

-------------------------------------------------------------------
3. Applications
-------------------------------------------------------------------

A. Interface (`apps/interface`)  
• Next.js 14, Tailwind, React Server Components.  
• Hosts the **voice widget** powered by VAPI and WebTransport.  
• Accepts per-assistant sub-domains or route params (`/[assistantId]`) enabling white-labelling.  
• Exposes JSON endpoints consumed by NCP (`/api/agendaList`, `/api/activity`, etc.).  
• Design docs: *NiaXP – The Next Generation of Hospitality* (May 2025, January 2025) give deep UX rationale.

B. Dashboard (`apps/dashboard`)  
• Next.js app focused on operations staff & developers.  
• Functions you'll find in `src/` include:  
  – create / edit assistant "profiles" (branding colours, greeting text, Twilio numbers).  
  – publish workflow → triggers Turbo rebuild + redeploy.  
• Deploys agents by writing config rows to the database that the chat engine hot-loads at start-up.

C. NCP – Nia Context Protocol (`apps/ncp`)  
• Pure backend; never serves HTML.  
• Pulls structured data from `interface`'s API (or a CMS) and reshapes it so the LLM can read concise system messages.  
• All endpoints are `POST` and return two keys:  
  `system_message` (ready for the LLM) and `metadata`.  
• Unit tests live in `apps/ncp/tests`, and shell scripts in `apps/ncp/scripts` allow quick manual smoke tests.

D. Chat Agent (`packages/core/nia-chat-agent`)  
• Entry-point: `main.py` (or `api_server.py` when running as an HTTP service).  
• Implements an Assistant class that:  
  1. Parses user requests.  
  2. Decides whether to call a "tool" (functions in `functions/`).  
  3. Streams a response through FastAPI, Twilio, or WebTransport.  
• Pluggable tool system – e.g. `weather_ops.py`, `system_ops.py`, `note_ops.py`.  
• Session & authentication helpers in `utils/`.  
• Persistent user notes in `quick_notes/`, demo account DB in `data/user_list.json`.

E. Relay Server (`packages/core/nia-py-server`)  
• Single-file Flask app (`vapi_serve.py`) that receives *end-of-transcript* webhooks and stores them in MongoDB.  
• Only required when using the VAPI speech provider; otherwise optional.

-------------------------------------------------------------------
4. Agents Concept
-------------------------------------------------------------------

An *agent* (a.k.a. assistant) is a named configuration bundle:

• `assistantName` (slug) – doubles as the sub-domain.  
• Voice persona & TTS provider configuration (ElevenLabs voice ID or Kokoro selection).  
• Colour palette / logo for UI theming.  
• Enabled tools and NCP keyword filters.  
• Twilio phone number(s) or WhatsApp sender.  

Agents are defined via the Dashboard and persisted in the database (or JSON during local dev).  
When the Interface boots, it calls `getAssistantBySubDomain()` to fetch the definition, then hydrates the React context so every component can adjust styling and API calls.

Out-of-the-box agents you'll see referenced in code:  

| Name | Scenario |
|------|----------|
| `nia-india` | Demo hotel concierge (default localhost). |
| `seatrade` / `seatrade-jdx` | Cruise-line conference companion (blue & orange accents). |
| `nia-ambassador` | Lightweight SMS-only agent for networking events. |

-------------------------------------------------------------------
5. Build, Dev & Test Tooling
-------------------------------------------------------------------

• **Monorepo Manager** – Yarn 4 workspaces + TurboRepo (`turbo.json`) orchestrate builds across Node and Python projects.  
• **Linting** – ESLint + Prettier for TS/JS, Ruff for Python (config in `apps/ncp/ruff.toml`).  
• **Type-Checking** – TypeScript's `tsc` and Python `mypy`.  
• **Scripts**  
  – `yarn install:all` – bootstrap every workspace.  
  – `yarn start:all` – spins up Interface (:3000), Dashboard (:4000), NCP (:8000) and Chat Agent (:8000 Python).  
  – `./lint.sh` / `./test.sh` – helper scripts used by CI and by the Aider AI tool.  
• **CI** – GitHub Actions matrix (Node 18/20, Go for edge services) - see pipeline files outside the repo (not shipped here).

-------------------------------------------------------------------
6. Running Locally (Happy Path)
-------------------------------------------------------------------

```bash
# 0. One-off
corepack enable                   # Yarn 4
yarn install                      # root deps
yarn install:all                  # every workspace
cp .env.example .env              # fill in OpenAI, Twilio, etc.

# 1. Everything, everywhere
yarn start:all
# -> Interface http://localhost:3000
# -> Dashboard http://localhost:4000
# -> NCP & Chat Agent http://localhost:8000

# 2. Separate terminals (if preferred)
yarn workspace interface dev
yarn workspace nia-dashboard dev
yarn start:nia                    # FastAPI agent server
```

Python services assume a venv; see `packages/core/nia-chat-agent/readme.md` for full instructions (Ngrok + Twilio webhook setup if you need SMS/WhatsApp).

-------------------------------------------------------------------
7. Deployment Overview
-------------------------------------------------------------------

• **Interface & Dashboard** – Vercel (Edge & Serverless).  
• **NCP** – Fly.io or AWS Fargate; fast redeploy via CI.  
• **Chat Agent** – Fly.io, scaled-to-zero or dedicated GPU cluster if using Llama.  
• **Data Plane** – MongoDB Atlas (guest profiles, transcripts), Snowflake (analytics), Redis (ephemeral context).  
• **Observability** – OpenTelemetry traces wired from Next.js edge to FastAPI.  
• **Blue/Green** – handled by Vercel Preview environments + Fly.io release commands.

-------------------------------------------------------------------
8. Key Reference Documents
-------------------------------------------------------------------

1. Root quick-start and monorepo commands – `README.md`.  
2. Nia Context Protocol deep-dive – `apps/ncp/README.md`.  
3. Chat Agent capabilities & tool system – `packages/core/nia-chat-agent/readme.md`.  
4. Product/UX vision & roadmap –  
   • `apps/interface/docs/NiaXP_ The Next Generation of Hospitality 2025 May Design Document and System Overview.txt`  
   • `apps/interface/docs/NiaXP_ The Next Generation of Hospitality 2025 January Design Document and System Overview.txt`  
5. Historical architecture thoughts – `apps/interface/docs/deprecated/Monorepo Design Document.rtf`, `Modular Features Design Document.rtf`.

(The folder `docs/VIVI` contains unrelated experiments and is intentionally excluded.)

-------------------------------------------------------------------
9. Where to Go Next
-------------------------------------------------------------------

• Need to extend an assistant?  Start in `dashboard/src/` – add form fields, then consume them in `interface/src/hooks/useVapi.ts` and `packages/core/nia-chat-agent/config/*.py`.  
• Building a new data endpoint?  Scaffold a service in `apps/ncp/ncp/services/`, add a route, and point `interface` fetchers to it.  
• Creating a brand-new tool (function calling) for the LLM?  Place it in `packages/core/nia-chat-agent/functions/`, register it in `config/tools_config.py`, and add a test in `tests_/`.

### Who should read this?
If you can open VS Code and run a couple of terminal commands, this guide is for you. No deep React, Python, or cloud knowledge required—each section links to friendly primers.

> **Goal:** By the end you should be able to say "I know exactly which folder to open to add a new button, endpoint, or AI skill."

---

#### Quick Glossary (👀 bookmark this!)
| Term | Plain-English meaning |
|------|----------------------|
| **Agent / Assistant** | A named bundle of settings (theme, voice, tools) powering one chatbot/voice bot. |
| **Interface** | The front-end guests actually see (Next.js). |
| **Dashboard** | The admin panel for non-devs to tweak agents. |
| **NCP** | "Nia Context Protocol", a FastAPI micro-service that turns raw event data into short, AI-friendly facts. |
| **Tool** | A Python function the AI can call for extra info or an action (send SMS, look up weather…). |
| **TurboRepo** | The build runner that coordinates all Node workspaces. |
| **VAPI** | Our voice streaming provider that pipes audio to/from the browser.

-------------------------------------------------------------------
10. Common Development Recipes ("Show me how to…")  
-------------------------------------------------------------------
| Goal | What to edit | 1-Liner Explanation |
|------|--------------|---------------------|
| Change the widget's primary colour | `apps/interface/src/components/assistant-button.tsx` (Tailwind classes near bottom) | Update the colour class e.g. `bg-[--nia-navy]` → `bg-fuchsia-600`. |
| Add a new FAQ link in the dashboard | `apps/dashboard/src/app/page.tsx` | Insert an object in the `links` array. |
| Teach the AI to fetch stock prices | 1. `packages/core/nia-chat-agent/functions/stock_ops.py`  2. Register in `config/tools_config.py` | Follow the pattern in `weather_ops.py`. |
| Expose a new `/showVenues` endpoint | 1. `apps/ncp/ncp/services/venue_service.py`  2. `apps/ncp/ncp/routers/venue_routes.py` | Copy `agenda_service.py`, adjust url & schema. |
| Make the guest UI default to French | `apps/interface/src/hooks/useVapi.ts` (`clientLanguage` default) | change `'en'` → `'fr'`. |

-------------------------------------------------------------------
11. Troubleshooting & FAQ  
-------------------------------------------------------------------
**"The site won't build, yarn complains about the package manager."**  
Run `corepack enable && corepack prepare yarn@4.6.0 --activate`.

**"Python cannot find FastAPI."**  
Activate the venv where you ran `pip install -r requirements.txt`.

**"My new tool never shows up."**  
Did you import it in `config/tools_config.py` *and* restart `yarn start:nia`?

-------------------------------------------------------------------
12. Next Steps for Learners  
-------------------------------------------------------------------
1. Walk through the *Getting Started* section in each app's `README.md`—they are short and beginner-friendly.  
2. Skim one of the design docs listed in Section 8 to understand *why* certain choices were made.  
3. Pick a recipe from Section 10 and try it in a branch.  Commit early & often!

Happy hacking—remember, you can't break production in your local dev environment.  Experiment boldly and let the AI assistants guide you.

-------------------------------------------------------------------
13. AI Development Reference – Cheat-Sheet for Generative Agents
-------------------------------------------------------------------
The following section is **machine-oriented**: it spells out every contract, pattern, and naming rule that a coding-capable AI (or an extremely curious human) needs in order to extend the Nia-Universal platform without breaking conventions.

### 13.1 Toolchain Versions
| Stack | Version | Path to Config |
|-------|---------|----------------|
| Node.js | 18 LTS (works with 16.9+) | `.nvmrc` (if present) |
| Yarn | 4.6.0 | managed by Corepack; see root `package.json` |
| TurboRepo | ^1.12 | `turbo.json` |
| TypeScript | ^5.4 | individual `tsconfig.json` files |
| Python | 3.10 (minimum 3.8) | shebangs & `requirements*.txt` |
| FastAPI | ^0.111 | `apps/ncp/requirements.txt` |
| Ruff (lint) | ^0.4 | `apps/ncp/ruff.toml` |
| Jest / Vitest | Jest for legacy, Vitest in new code | per-package dev deps |

### 13.2 Directory Conventions (Source-of-Truth)
| Folder | Mandate |
|--------|---------|
| `apps/<name>/src/components/` | React components — *one component per file*; `.tsx` only. |
| `apps/<name>/src/app/` | Next.js server-components and route handlers (`route.ts`). |
| `apps/ncp/ncp/services/` | Pure Python "business logic". Each file exposes `async def get_<entity>()` helpers. |
| `apps/ncp/ncp/routers/` | FastAPI routers; *one resource per file*; must call service layer; Pydantic models live next to router. |
| `packages/core/nia-chat-agent/functions/` | **LLM tools**. Filename ends with `_ops.py`; must export `def run(**kwargs)` plus a `SCHEMA` (Pydantic `BaseModel`). |
| `packages/core/nia-chat-agent/config/tools_config.py` | Central registry; map `tool_name` → `{ "fn": callable, "schema": PydanticModel }`. |

### 13.3 Adding a **Frontend** Feature
1. Create a component inside `apps/interface/src/components/`.  
   Naming: `ThingList.tsx` (PascalCase).  
2. Import it into a page via RSC (`apps/interface/src/app/...`).  
3. If data-fetching is required, create a route under `src/app/api/<thing>/route.ts`.  *Return JSON only.*  
4. **Styling:** prefer Tailwind utility classes; shared colours live in `tailwind.config.mts` under the theme extension.
5. Add a unit test (`ThingList.test.tsx`) using React Testing Library & Vitest.

### 13.4 Adding an **NCP** Endpoint
```bash
# scaffold
apps/ncp/ncp/services/venue_service.py
apps/ncp/ncp/routers/venue_routes.py
```
Skeleton:
```python
# venue_service.py
from ncp.services.utils import make_api_get_request

async def list_venues(query: list[str] | None = None):
    return await make_api_get_request("/api/venueList", params={"query": query})
```
```python
# venue_routes.py
from fastapi import APIRouter
from pydantic import BaseModel
from ncp.services.venue_service import list_venues

router = APIRouter()

class ListVenuesRequest(BaseModel):
    assistantName: str
    query: list[str] | None = None

@router.post("/showVenues")
async def show_venues(body: ListVenuesRequest):
    data = await list_venues(body.query)
    return {
        "system_message": f"Here are {len(data)} venues…",
        "metadata": data,
    }
```
Finally, import the router in `ncp/__init__.py`.

### 13.5 Adding a **Chat-Agent Tool**
1. Create `packages/core/nia-chat-agent/functions/time_ops.py`:
```python
from pydantic import BaseModel
from datetime import datetime

class TimeSchema(BaseModel):
    timezone: str = "UTC"

def run(timezone: str):
    return {"time": datetime.now().astimezone().isoformat()}
```
2. Register in `config/tools_config.py`:
```python
from functions import time_ops
TOOLS["get_time"] = {
    "fn": time_ops.run,
    "schema": time_ops.TimeSchema,
}
```
3. Restart the Python server (`yarn start:nia`). The LLM can now call `get_time` by name.

### 13.6 Environment Variables (📜 canonical list)
| Key | Used by | Example Value |
|-----|---------|---------------|
| `OPENAI_API_KEY` | Chat-Agent | `sk-…` |
| `ANTHROPIC_API_KEY` | Chat-Agent | `anthropic-key` |
| `GROQ_API_KEY` | Chat-Agent (default) | `groq-key` |
| `ELEVENLABS_API_KEY` | Interface (TTS) | `e11e-…` |
| `TWILIO_ACCOUNT_SID` | Chat-Agent | `ACxxxxxxxx` |
| `TWILIO_AUTH_TOKEN` | Chat-Agent | `xxxxxxxx` |
| `MONGODB_URI` | Relay + Chat-Agent | `mongodb+srv://…` |
| `NEXT_PUBLIC_VAPI_KEY` | Interface | `pk_live_…` |

Variables are discovered via `os.getenv()` or `process.env` — **never** hard-code credentials.

### 13.7 Testing & Quality Gates
• **TS/JS:** `pnpm vitest run --coverage`. Coverage threshold ≥ 80 %.  
• **Python:** `pytest --cov`. Same threshold.  
• **Lint:** `yarn lint`, `ruff check`. Fail CI on any errors.  
• **Type Safety:** TypeScript strict mode, `mypy --strict` for Python services.

### 13.8 CI/CD Pipeline Flow (GitHub Actions)
1. **Lint ➜ Test ➜ Build** for each workspace in a matrix.  
2. If `main` branch and all checks green:  
   • Vercel deploy (Interface + Dashboard).  
   • Fly.io deploy (NCP + Chat-Agent).  
   • Tag & push Docker images to GHCR.  
3. Preview branches deploy to Vercel Preview URLs; teardown on PR close.

### 13.9 Assistant JSON Schema (for Dash-board ↔ Agent sync)
```jsonc
{
  "assistantName": "string",
  "displayName": "string",
  "voiceId": "string",            // Voice id for the selected provider
  "voiceProvider": "elevenlabs",  // or "kokoro"
  "brandColor": "#RRGGBB",
  "logoUrl": "https://…",
  "tools": ["weather", "stock"],   // must exist in tools_config
  "preferredLocale": "en-US",
  "twilioNumber": "+1234567890"
}
```
Stored in MongoDB `assistants` collection; retrieved by `getAssistantBySubDomain()`.

### 13.10 End-to-End Example: *"Add Currency Conversion"*
1. **LLM Tool** – `currency_ops.py` already exists; ensure it exposes `run()` and a `CurrencySchema`.  
2. **Register Tool** – update `TOOLS` registry.  
3. **Dashboard Field** – add checkbox "Currency Converter" in `dashboard/src/components/ToolsPane.tsx`.  
4. **NCP?** – Not required (no external context).  
5. **Interface** – no change; the AI will decide when to call the tool.  
6. **Tests** – add unit test in `tests_/test_currency.py` to validate correct JSON output.  
7. **Docs** – update Section 10 recipe table.

### 13.11 Golden Rules (💡 Memorise!)
1. **Single Source of Truth** – business logic lives server-side; React components *present* data only.  
2. **LLM Safety** – every tool must validate its input via Pydantic before execution.  
3. **No Blocking IO in React** – use `fetch()` in server actions or SWR in client components.  
4. **Commit Style** – Conventional Commits (`feat:`, `fix:`, `docs:`…).  
5. **Pull Requests** – must include *at least one* test and pass CI.

With these contracts an autonomous agent has everything it needs to scaffold, code, and wire a brand-new feature—be that a UX widget, a backend API, or a tool the LLM can invoke. Good luck building the next delightful guest experience! 
 
