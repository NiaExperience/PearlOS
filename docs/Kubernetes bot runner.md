# Kubernetes bot runner

## Scaling Direction

- Treat the FastAPI control server as an orchestrator only. Run it in a stable pod (or replica set) and strip out local process spawning. Instead, when /join (or an equivalent API) is called, the server should enqueue a launch request (Kubernetes Job, kubectl run, KEDA-triggered deployment, or plain queue + worker). Each bot session then runs in its own runner-mode pod/container. This keeps the control plane stateless and horizontal while sessions scale linearly with workload.

- Stand up a “bot runner” image that drops straight into runner_main.py. The control plane passes the session configuration (room URL, preloaded prompts, persona, tokens, feature flags) as container env vars or CLI args. Runner mode already accepts preloaded records via env (BOT_PERSONALITY_RECORD, BOT_FUNCTIONAL_PROMPTS, BOT_SUPPORTED_FEATURES), so we get warm personalities, prompts, and voice settings without repeated Mesh fetches. Bake common content into the image or hydrate from Redis/Memcached on boot, then let the runner session start with everything cached.

- For faster engagement, precompute per-personality assets (prompt templates, tool manifests, voice configs) and mount them via ConfigMap/Secret or share via Redis. Runner mode can read those files before calling build_pipeline, skipping DB/API hits. If you need tenant-specific data, feed it as part of the launch request so the runner picks it up on start.
Event Bus Topology

- Keep the in-process bus for hot-path pipeline events, but add an adapter layer that can publish to an external broker (Redis streams, NATS, or Kafka). The session still publishes locally for low latency; when the adapter is enabled it mirrors envelopes out-of-process.

- The control server subscribes to the external broker rather than an IPC pipe, so it can stream /events even though the session lives in a separate pod. Consumers (UI dashboards, alerting, integration tests) also subscribe to that broker. This “flattening” removes the tight coupling between session processes and the control-plane pod while preserving the clear contract of versioned envelopes.

- If i/o volume stays moderate, Redis Pub/Sub or Streams is the simplest drop-in. For higher fan-out or persistence requirements, graduate to Kafka (with topic per bot room or tenant) or NATS JetStream. Either way, abstract the current event bus behind an interface so the session only knows “publish(payload)” and a transport plugin handles local vs distributed delivery.

## Hybrid Flow Example

- /join hits control server.

- Control server writes a launch request to a queue (e.g., Redis list).

- A fleet of runner pods (managed by a Job controller or scalable worker) pulls the request, sets env vars (preloaded persona, cached prompts, daily token), and runs runner_main.py.

- Runner publishes events to Redis Streams via the new bus adapter; control server streams from that channel to clients.

- When the session ends, runner emits bot.session.end, cancels itself, and the Job/pod dies.
