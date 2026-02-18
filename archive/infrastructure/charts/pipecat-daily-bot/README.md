# Pipecat Daily Bot Helm Chart

Deploys the Pipecat Daily Bot service into a dedicated namespace. This chart mirrors the existing staging deployment and exposes configuration for image settings, environment variables, ConfigMaps, and secrets.

## Installing

```bash
helm install pipecat-daily-bot-stg ./charts/pipecat-daily-bot \
  --namespace pipecat-daily-bot-stg \
  --create-namespace \
  -f ./charts/pipecat-daily-bot/values-stg.yaml
```

## Configuration

| Key | Description | Default |
| --- | ----------- | ------- |
| `fullnameOverride` | Override for chart fullname (used for namespace/name) | `""` (derives from release name) |
| `image.repository` | Container image repository | `577124901432.dkr.ecr.us-east-2.amazonaws.com/pipecat-daily-bot` |
| `image.tag` | Image tag | `latest` |
| `service.port` | Service port | `4444` |
| `service.type` | Service type | `ClusterIP` |
| `service.headless` | Whether to create a headless service | `true` |
| `configMap.data` | ConfigMap key/value pairs | `{}` |
| `configMap.existingName` | Name of an existing ConfigMap when `configMap.create` is `false` | `""` |
| `secret.name` | Name of the existing Kubernetes secret to mount via `envFrom` | `pipecat-daily-bot-secret` |

Refer to `values.yaml` for the full list of options.

### Staging Example

`values-stg.yaml` mirrors the current staging deployment. Ensure the referenced secret (`secret.name`) exists and replace placeholder values (for example `KOKORO_TTS_API_KEY`) with the real values through your preferred secret management workflow before applying. Set `namespace.create` to `false` when installing into an existing namespace and set `configMap.create` to `false` with `configMap.existingName` pointing at the current ConfigMap to avoid Helm ownership conflicts while adopting existing resources.

### Pearl Example

`values-pearl.yaml` captures the production configuration for the pearl environment. Provision `pipecat-daily-bot-pearl-secret` in the `pipecat-daily-bot-pearl` namespace before deploying, update domain- and service-specific fields as needed (for example, `MESH_API_ENDPOINT`, `REDIS_URL`, and the Kokoro TTS settings), and supply real secret values in your preferred secret store.
