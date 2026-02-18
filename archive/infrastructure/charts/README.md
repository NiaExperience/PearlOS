# Nia Universal Helm Charts

This directory contains Helm charts for deploying the Nia Universal platform services to Kubernetes. Each service is deployed in its own namespace for better isolation and security.

## 📋 Charts Overview

| Chart | Description | Port | Features |
|-------|-------------|------|----------|
| **interface** | Main web interface service | 3000 | Nginx auth proxy, External Secrets support |
| **mesh** | GraphQL mesh service for data integration | 2000 | GraphQL API, data federation |
| **dashboard** | Analytics and management dashboard | 3000 | Admin interface, monitoring |
| **kokoro-tts** | Kokoro text-to-speech service | 8000 | GPU-ready FastAPI service, ClusterIP exposure |
| **pipecat-daily-bot** | Pipecat Daily bot worker | 4444 | Headless service, ConfigMap + Secret env wiring |

## 🚀 Quick Start

### Prerequisites

- Kubernetes cluster with ALB Ingress Controller
- Helm 3.x installed
- **Helm Secrets plugin** (`helm plugin install https://github.com/jkroepke/helm-secrets`)
- **SOPS** installed (`brew install sops` or equivalent)
- kubectl configured to access your cluster
- AWS ECR access for container images
- AWS KMS permissions (if using KMS for SOPS)

### 1. Add the charts to your Helm repository

```bash
# From the project root
helm repo add nia-universal ./charts
```

### 2. Deploy a single service

```bash
# Deploy interface to pearl environment
helm install interface-pearl ./charts/interface \
  --namespace interface-pearl \
  --create-namespace \
  -f ./charts/interface/values-pearl.yaml

# Deploy mesh to pearl environment
helm install mesh-pearl ./charts/mesh \
  --namespace mesh-pearl \
  --create-namespace \
  -f ./charts/mesh/values-pearl.yaml

# Deploy dashboard to pearl environment
helm install dashboard-pearl ./charts/dashboard \
  --namespace dashboard-pearl \
  --create-namespace \
  -f ./charts/dashboard/values-pearl.yaml
```

### 3. Deploy all services

```bash
# Deploy all services to pearl environment
helm install interface-pearl ./charts/interface \
  --namespace interface-pearl \
  --create-namespace \
  -f ./charts/interface/values-pearl.yaml

helm install mesh-pearl ./charts/mesh \
  --namespace mesh-pearl \
  --create-namespace \
  -f ./charts/mesh/values-pearl.yaml

helm install dashboard-pearl ./charts/dashboard \
  --namespace dashboard-pearl \
  --create-namespace \
  -f ./charts/dashboard/values-pearl.yaml
```

## 📁 Directory Structure

```
charts/
├── README.md                 # This file
├── .gitignore               # Git ignore rules for charts
├── interface/               # Interface service chart
│   ├── README.md           # Interface-specific documentation
│   ├── Chart.yaml          # Chart metadata
│   ├── values.yaml         # Default values
│   ├── values-pearl.yaml   # Pearl environment values
│   └── templates/          # Helm templates
├── mesh/                   # Mesh service chart
│   ├── README.md           # Mesh-specific documentation
│   ├── Chart.yaml          # Chart metadata
│   ├── values.yaml         # Default values
│   ├── values-pearl.yaml   # Pearl environment values
│   └── templates/          # Helm templates
├── dashboard/              # Dashboard service chart
│   ├── README.md           # Dashboard-specific documentation
│   ├── Chart.yaml          # Chart metadata
│   ├── values.yaml         # Default values
│   ├── values-pearl.yaml   # Pearl environment values
│   └── templates/          # Helm templates
└── scripts/                # Utility scripts and setup tools
    ├── EXTERNAL_SECRETS_SETUP.md
    ├── setup-aws-secrets.sh
    ├── setup-aws-access-keys.sh
    ├── insert-secrets.py
    ├── db.sh
    ├── dump-restore.sh
    ├── external-secrets-iam-policy.json
    ├── aws-secrets-manager-setup.yaml
    └── aws-secrets-manager-setup-access-keys.yaml
```

## ⚙️ Configuration

### Values Files

Each chart has values files for the pearl environment:

- `values.yaml`: Default values
- `values-pearl.yaml`: Pearl environment overrides

### Common Configuration Options

#### Image Configuration

```yaml
image:
  repository: 577124901432.dkr.ecr.us-east-2.amazonaws.com/interface
  tag: "latest"
  pullPolicy: IfNotPresent
```

#### Resource Limits

```yaml
resources:
  limits:
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 256Mi
```

#### Ingress Configuration

```yaml
ingress:
  enabled: true
  className: "alb"
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: "443"
    external-dns.alpha.kubernetes.io/hostname: interface.stg.nxops.net
  hosts:
    - host: interface.stg.nxops.net
      paths:
        - path: /
          pathType: Prefix
```

#### Environment Variables

```yaml
env:
  NODE_ENV: "production"
  DATABASE_URL: "postgresql://user:pass@host:5432/db"
```

#### Secrets and ConfigMaps

```yaml
# ConfigMap data
configMap:
  data:
    config.json: |
      {
        "apiUrl": "https://api.example.com"
      }

# Secret management - choose one approach:
secret:
  enabled: true
  # Option 1: Reference existing secret (recommended)
  existingSecret: "my-app-secret"
  # Option 2: External Secrets Operator
  externalSecret:
    enabled: false
    name: ""
  # Option 3: Inline data (NOT recommended for production)
  data:
    DATABASE_URL: "cG9zdGdyZXNxbDovL3VzZXI6cGFzc3dkQGhvc3Q6NTQzMi9kYg=="
```

## 🔧 Scripts and Utilities

The `scripts/` directory contains useful utilities for managing deployments:

### External Secrets Setup

- `EXTERNAL_SECRETS_SETUP.md` - Complete guide for setting up External Secrets Operator
- `setup-aws-secrets.sh` - Automated AWS Secrets Manager setup
- `setup-aws-access-keys.sh` - AWS access key configuration
- `external-secrets-iam-policy.json` - IAM policy for External Secrets Operator

### Database Management

- `db.sh` - Database connection and management utilities
- `dump-restore.sh` - Database backup and restore operations
- `insert-secrets.py` - Python script for inserting secrets

### Kubernetes Resources

- `aws-secrets-manager-setup.yaml` - Kubernetes resources for AWS Secrets Manager
- `aws-secrets-manager-setup-access-keys.yaml` - Access key configuration

## 🛠️ Management Commands

### List Releases

```bash
helm list --all-namespaces
```

### Upgrade a Release

```bash
helm upgrade interface-pearl ./charts/interface \
  --namespace interface-pearl \
  -f ./charts/interface/values-pearl.yaml
```

### Rollback a Release

```bash
helm rollback interface-pearl 1 --namespace interface-pearl
```

### Uninstall a Release

```bash
helm uninstall interface-pearl --namespace interface-pearl
```

### View Release Status

```bash
helm status interface-pearl --namespace interface-pearl
```

### Get Values

```bash
helm get values interface-pearl --namespace interface-pearl
```

## 🔍 Troubleshooting

### Check Pod Status

```bash
kubectl get pods -n interface-pearl
kubectl get pods -n mesh-pearl
kubectl get pods -n dashboard-pearl
```

### View Pod Logs

```bash
kubectl logs -n interface-pearl deployment/interface-pearl
kubectl logs -n mesh-pearl deployment/mesh-pearl
kubectl logs -n dashboard-pearl deployment/dashboard-pearl
```

### Check Ingress Status

```bash
kubectl get ingress -n interface-pearl
kubectl get ingress -n mesh-pearl
kubectl get ingress -n dashboard-pearl
```

### Check Services

```bash
kubectl get svc -n interface-pearl
kubectl get svc -n mesh-pearl
kubectl get svc -n dashboard-pearl
```

## 🔐 Security Considerations

1. **Namespace Isolation**: Each service runs in its own namespace
2. **Resource Limits**: All charts include resource limits and requests
3. **Secrets Management**: Multiple secure options for handling secrets
4. **Network Policies**: Consider adding network policies for additional security

## 🔑 Secret Management

The charts support multiple approaches for handling secrets securely:

### Option 1: External Secrets Operator (Recommended for Production)

Use External Secrets Operator to fetch secrets from external sources like AWS Secrets Manager or HashiCorp Vault:

```yaml
# values.yaml
secret:
  enabled: true
  externalSecret:
    enabled: true
    name: "my-app-external-secret"
```

**Setup:**
```bash
# Install External Secrets Operator
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets

# Create ExternalSecret
kubectl apply -f - <<EOF
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: interface-stg-external-secret
  namespace: interface-stg
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: interface-stg-secret
  data:
  - secretKey: DATABASE_URL
    remoteRef:
      key: nia/interface/database-url
  - secretKey: API_KEY
    remoteRef:
      key: nia/interface/api-key
EOF
```

### Option 2: Existing Secrets (Good for Development)

Create secrets separately and reference them:

```yaml
# values.yaml
secret:
  enabled: true
  existingSecret: "interface-stg-secret"
```

**Create secret manually:**
```bash
kubectl create secret generic interface-stg-secret \
  --from-literal=DATABASE_URL="postgresql://user:pass@host:5432/db" \
  --from-literal=API_KEY="your-api-key" \
  --namespace interface-stg
```

### Option 3: Inline Secrets (NOT Recommended for Production)

Only use for development/testing:

```yaml
# values.yaml
secret:
  enabled: true
  data:
    DATABASE_URL: "cG9zdGdyZXNxbDovL3VzZXI6cGFzc3dkQGhvc3Q6NTQzMi9kYg=="
```

### Option 4: Helm Secrets with SOPS (Current Staging Workflow)

We use [Mozilla SOPS](https://github.com/getsops/sops) with AWS KMS to encrypt secrets in git.

1.  **Structure:** Encrypted files are located at `charts/<app>/secrets.stg.yaml`.
2.  **Configuration:** `.sops.yaml` at repo root defines the KMS key.
3.  **Editing:**
    ```bash
    sops charts/interface/secrets.stg.yaml
    ```
4.  **Deploying:**
    ```bash
    helm secrets upgrade interface-stg charts/interface \
      --namespace interface-stg \
      -f charts/interface/values.yaml \
      -f charts/interface/secrets.stg.yaml
    ```
5.  **Populating from Cluster:** Use `scripts/populate_secrets.py` to fetch live secrets and update local encrypted files.

### Best Practices

1. **Never commit secrets to git** - Use `.gitignore` to exclude secret files
2. **Use External Secrets Operator** for production environments
3. **Rotate secrets regularly** - External Secrets Operator can help with this
4. **Use least privilege** - Only grant necessary permissions
5. **Audit secret access** - Monitor who accesses secrets and when

## 🚀 Production Deployment

For production deployments:

1. Create production-specific values files
2. Use proper image tags (not 'latest')
3. Configure proper resource limits
4. Set up monitoring and logging
5. Use proper SSL certificates
6. Configure backup strategies

## 📚 Chart-Specific Documentation

- [Interface Chart](./interface/README.md) - Web interface service with auth proxy
- [Mesh Chart](./mesh/README.md) - GraphQL mesh service for data integration
- [Dashboard Chart](./dashboard/README.md) - Analytics and management dashboard

## 🤝 Contributing

When adding new services:

1. Create a new chart directory
2. Follow the existing chart structure
3. Include proper documentation
4. Add staging and production values files
5. Test the chart thoroughly before deployment

## 📞 Support

For issues and questions:

1. Check the chart-specific README files
2. Review the troubleshooting section
3. Check the External Secrets setup guide in `scripts/EXTERNAL_SECRETS_SETUP.md`
4. Contact the Nia team at team@nia.com
