# Archived Infrastructure

> **These files were archived on January 2026 as part of the project simplification initiative.**

This folder contains Kubernetes and cloud infrastructure files that are not required for local development.

---

## Contents

| Folder | Purpose | When Needed |
|--------|---------|-------------|
| `charts/` | Helm charts for K8s deployment | Production/staging deploys |
| `infra/` | Flux GitOps + Terraform | Cloud infrastructure |
| `deployments/` | K8s staging manifests | Per-app K8s configs |
| `Tiltfile` | Local K8s dev orchestration | Container-based local dev |
| `Tiltfile.minimal` | Minimal Tilt (backend only) | Testing without frontend |

---

## Restoring Infrastructure

### Full Restore

```bash
cd /path/to/nia-universal

# Restore main infrastructure
mv archive/infrastructure/charts ./
mv archive/infrastructure/infra ./
mv archive/infrastructure/Tiltfile ./
mv archive/infrastructure/Tiltfile.minimal ./

# Restore deployment manifests
for app in interface dashboard mesh pipecat-daily-bot; do
  mv archive/infrastructure/deployments/$app-deployment apps/$app/deployment
done
```

### Partial Restore (Helm only)

```bash
mv archive/infrastructure/charts ./
```

### Partial Restore (Tilt only)

```bash
mv archive/infrastructure/Tiltfile ./
mv archive/infrastructure/Tiltfile.minimal ./
```

---

## Why Archived?

These files add complexity for developers who only need to run the platform locally:

1. **Helm Charts** - Only needed for Kubernetes cluster deployments
2. **Flux/Terraform** - Only needed for AWS cloud infrastructure
3. **Tiltfiles** - Only needed for containerized local development
4. **Deployment YAMLs** - Only needed for K8s staging environment

The platform runs perfectly with `npm run start:all` without any of these.

---

## Documentation

For details on what was removed and why, see:
- `docs/SIMPLIFICATION_IMPACT_REPORT.md` - Full impact analysis
- `SIMPLE_SETUP.md` - Simplified setup guide

---

## Original Structure

```
charts/
├── dashboard/          # Dashboard Helm chart
├── interface/          # Interface Helm chart
├── mesh/               # Mesh Helm chart
├── pipecat-daily-bot/  # Bot Helm chart
├── redis/              # Redis Helm chart
├── kokoro-tts/         # TTS Helm chart
└── scripts/            # AWS secrets setup

infra/
├── base/               # Flux operator base
├── clusters/           # Flux cluster configs
└── terraform/          # AWS Synthetics canary

deployments/
├── interface-deployment/
├── dashboard-deployment/
├── mesh-deployment/
└── pipecat-daily-bot-deployment/
```

