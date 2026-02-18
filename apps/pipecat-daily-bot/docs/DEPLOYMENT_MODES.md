# Pipecat Daily Bot: Deployment Modes

The bot container (`nia-pipecat-bot`) is a multi-purpose image that can run in three distinct modes, controlled by the `MODE` environment variable.

## 1. Gateway Mode (`MODE=gateway`)

* **Entrypoint**: `bot/gateway.py`
* **Port**: 4444
* **Role**: API Entry Point.
* **Function**:
  * Accepts HTTP `POST /join` requests.
  * Accepts HTTP `POST /admin` requests (for sending commands to running bots).
  * Validates request payload.
  * Pushes job to Redis queue `bot:launch:queue`.
  * Publishes admin messages to Redis Pub/Sub.
* **Scaling**: Stateless. Scale horizontally based on HTTP traffic.

## 2. Operator Mode (`MODE=operator`)

* **Entrypoint**: `bot/bot_operator.py`
* **Role**: Orchestrator.
* **Function**:
  * Watches Redis queue `bot:launch:queue`.
  * Manages the lifecycle of bot sessions.
  * **Warm Start**: Dispatches jobs to idle runners in the Warm Pool (`bot:standby:pool`).
  * **Cold Start**: Creates Kubernetes Jobs for overflow capacity.
* **Scaling**: Singleton (usually). Multiple operators might race on queue items unless using consumer groups (currently using simple `BLPOP`).

## 3. Runner Mode (`MODE=runner`)

* **Entrypoint**: `bot/runner_main.py`
* **Port**: 7860 (or 8080)
* **Role**: Bot Execution.
* **Function**: Runs the actual Pipecat pipeline (Daily transport, STT, LLM, TTS).

### Runner Sub-Modes

The runner behavior is further controlled by `RUNNER_AUTO_START`.

#### A. Standby (Warm Pool)

* **Config**: `RUNNER_AUTO_START=0`
* **Behavior**:
  * Starts up and initializes dependencies.
  * Registers its internal IP/URL to Redis `bot:standby:pool`.
  * Waits for HTTP `POST /start` from the Operator.
  * Upon receiving `/start`, connects to the Daily room.

#### B. Auto-Start (Cold Job)

* **Config**: `RUNNER_AUTO_START=1`
* **Behavior**:
  * Expects `DAILY_ROOM_URL` and other config in environment variables.
  * Immediately connects to the Daily room on startup.
  * Used by Kubernetes Jobs spawned by the Operator.

## Docker Usage

```bash
# Build
docker build -f apps/pipecat-daily-bot/Dockerfile -t pipecat-bot .

# Run Gateway
docker run -e MODE=gateway -p 4444:4444 pipecat-bot

# Run Operator
docker run -e MODE=operator -e REDIS_URL=... pipecat-bot

# Run Runner (Standby)
docker run -e MODE=runner -e RUNNER_AUTO_START=0 -p 8080:8080 pipecat-bot
```
