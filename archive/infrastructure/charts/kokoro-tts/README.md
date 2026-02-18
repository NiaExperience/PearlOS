# Kokoro TTS Helm Chart

Helm chart for deploying the Kokoro text-to-speech service. The chart mirrors the structure used across other Nia Universal services and exposes the application via a ClusterIP service (no ingress/ALB by default).

## Values

Key configuration options:

- `image.repository` / `image.tag` – container image location and tag.
- `service.port` / `service.targetPort` – Kubernetes service and container port (default 80 -> 8000).
- `resources.limits.nvidia.com/gpu` – GPU reservation (defaults to 1) required for CUDA-backed inference. A matching toleration for `nvidia.com/gpu=true` is set on the pod template.
- `env` – static environment variables injected into the pod (defaults `ORT_PROVIDERS=CUDAExecutionProvider,CPUExecutionProvider` so ONNX Runtime falls back to CPU if needed).
- `configMap.data` – environment variables delivered via ConfigMap (defaults include model/voices paths).
- `secret.*` – optional reference to an existing Kubernetes Secret for sensitive values (disabled by default).

See `values.yaml` for defaults and `values-pearl.yaml` for production overrides.
