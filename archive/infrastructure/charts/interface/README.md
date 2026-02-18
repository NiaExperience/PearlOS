# Interface Helm Chart

This Helm chart deploys the Nia Universal Interface application with comprehensive secret management capabilities.

## 🎯 Overview

The Interface service provides:
- **Main Web Application**: Primary user interface for the Nia Universal platform
- **External Secrets Integration**: Secure secret management with AWS Secrets Manager
- **Multi-Environment Support**: Staging, production, and pearl environments
- **Scalable Architecture**: Configurable replicas and resource management

## 🚀 Quick Start

### Basic Deployment

```bash
# Deploy to pearl environment
helm install interface-pearl ./charts/interface \
  --namespace interface-pearl \
  --create-namespace \
  -f ./charts/interface/values-pearl.yaml
```

### With External Secrets

The pearl environment values file includes External Secrets Operator configuration by default.

### Namespace Management

The chart creates its target namespace by default. When deploying into an existing namespace (for example, `interface-stg`), disable namespace creation:

```yaml
namespace:
  create: false
```

## ⚙️ Configuration

### Default Values

The chart uses these default values:

```yaml
replicaCount: 1

image:
  repository: 577124901432.dkr.ecr.us-east-2.amazonaws.com/interface
  tag: "latest"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 80
  targetPort: 3000  # Interface service port
  containerPortName: web

resources:
  limits:
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 256Mi
```

### Environment-Specific Values

#### Pearl Environment (`values-pearl.yaml`)

```yaml
replicaCount: 1

image:
  tag: "sha-0cad4610699c7051cc5bc6c60a542d1f759ff252"

service:
  targetPort: 3000
  containerPortName: web

certificateArn: "arn:aws:acm:us-east-2:577124901432:certificate/f1c65495-e771-4014-9dbb-b0e15f3cc5c1"

ingress:
  hostname: "pearlos.org,www.pearlos.org"
  annotations:
    alb.ingress.kubernetes.io/actions.redirect-naked-domain: |
      {
        "Type": "redirect",
        "RedirectConfig": {
          "Protocol": "HTTPS",
          "Host": "rsvp.pearlos.org",
          "Path": "/",
          "StatusCode": "HTTP_301"
        }
      }
  rules:
    - host: pearlos.org
      http:
        paths:
          - path: /
            pathType: Exact
            backend:
              service:
                name: redirect-naked-domain
                port:
                  name: use-annotation
          - path: /
            pathType: Prefix
            backend:
              service:
                name: interface-pearl
                port:
                  number: 80
    - host: www.pearlos.org
      http:
        paths:
          - path: /
            pathType: Exact
            backend:
              service:
                name: redirect-naked-domain
                port:
                  name: use-annotation
          - path: /
            pathType: Prefix
            backend:
              service:
                name: interface-pearl
                port:
                  number: 80
    - host: rsvp.pearlos.org
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: interface-pearl
                port:
                  number: 80

configMap:
  existingName: interface-pearl-config

secret:
  enabled: true
  externalSecret:
    enabled: true
    name: "interface-pearl-external-secret"
```

## 🔐 Secret Management

The Interface chart supports three approaches for secret management:

### 1. External Secrets Operator (Recommended)

Use External Secrets Operator to fetch secrets from AWS Secrets Manager:

```yaml
secret:
  enabled: true
  externalSecret:
    enabled: true
    name: "interface-external-secret"  # Optional custom name
```

This will create an ExternalSecret that fetches from:
- `nia/{interface.fullname}/anthropic-api-key`
- `nia/{interface.fullname}/database-url`
- `nia/{interface.fullname}/google-interface-client-id`
- `nia/{interface.fullname}/google-interface-client-secret`
- `nia/{interface.fullname}/mesh-shared-secret`
- `nia/{interface.fullname}/nextauth-secret`
- `nia/{interface.fullname}/postgres-*`
- And other application secrets...

### 2. Existing Secret

Reference an existing Kubernetes secret:

```yaml
secret:
  enabled: true
  existingSecret: "my-existing-secret"
```

### 3. Inline Data (Not recommended for production)

```yaml
secret:
  enabled: true
  data:
    DATABASE_URL: "base64-encoded-value"
    API_KEY: "base64-encoded-value"
```

## 🔧 Advanced Configuration

### Custom Environment Variables

```yaml
env:
  NODE_ENV: "production"
  PORT: "3000"
  LOG_LEVEL: "info"
  NEXT_PUBLIC_API_URL: "https://mesh.example.com"
  NEXT_PUBLIC_APP_URL: "https://interface.example.com"
  DATABASE_URL: "postgresql://user:pass@host:5432/db"
```

### ConfigMap Data

```yaml
configMap:
  existingName: ""
  data:
    interface-config.json: |
      {
        "api": {
          "baseUrl": "https://mesh.example.com",
          "timeout": 30000
        },
        "auth": {
          "enabled": true,
          "provider": "nextauth"
        },
        "features": {
          "analytics": true,
          "monitoring": true
        }
      }
```

Set `configMap.existingName` to reference a pre-created ConfigMap without templating its contents.

### Label Compatibility

Existing installations that still rely on the legacy `app: <release>` selector can retain it by enabling:

```yaml
labels:
  useLegacyAppLabel: true
```

This keeps the selector immutable during upgrades while still adding Kubernetes recommended `app.kubernetes.io/*` labels as metadata.

### Resource Configuration

```yaml
resources:
  limits:
    memory: 1Gi
    cpu: 1000m
  requests:
    cpu: 500m
    memory: 512Mi
```

### Ingress Configuration

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
    external-dns.alpha.kubernetes.io/hostname: interface.example.com
  hosts:
    - host: interface.example.com
      paths:
        - path: /
          pathType: Prefix
  tls: []
```

## 🔍 Monitoring and Health Checks

### Health Check Endpoint

The Interface service exposes a health check endpoint at `/health`:

```bash
# Check service health
curl https://interface.stg.nxops.net/health
```

### Application Endpoints

```bash
# Main application
open https://interface.stg.nxops.net

# API documentation (if available)
open https://interface.stg.nxops.net/api/docs
```

## 🛠️ Management

### Upgrade Deployment

```bash
helm upgrade interface-pearl ./charts/interface \
  --namespace interface-pearl \
  -f ./charts/interface/values-pearl.yaml
```

### Rollback

```bash
helm rollback interface-pearl 1 --namespace interface-pearl
```

### View Logs

```bash
kubectl logs -n interface-pearl deployment/interface-pearl
kubectl logs -n interface-pearl deployment/interface-pearl -f  # Follow logs
```

### Check Status

```bash
kubectl get pods -n interface-pearl
kubectl get svc -n interface-pearl
kubectl get ingress -n interface-pearl
```

## 🔐 Security

### Network Policies

Consider implementing network policies to restrict traffic:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: interface-network-policy
  namespace: interface-pearl
spec:
  podSelector:
    matchLabels:
      app: interface-pearl
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector: {}  # Allow from all namespaces
    ports:
    - protocol: TCP
      port: 3000
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          name: mesh-stg
    ports:
    - protocol: TCP
      port: 2000
```

### TLS Configuration

For production, configure proper TLS certificates:

```yaml
ingress:
  tls:
  - hosts:
    - interface.example.com
    secretName: interface-tls-secret
```

## 🚨 Troubleshooting

### Common Issues

1. **Service Not Responding**
   ```bash
       # Check pod status
    kubectl get pods -n interface-pearl
    
    # Check service endpoints
    kubectl get endpoints -n interface-pearl
    
    # Check logs
    kubectl logs -n interface-pearl deployment/interface-pearl
   ```

2. **Secret Issues**
   ```bash
   # Check if secrets are mounted
   kubectl describe pod -n interface-pearl -l app=interface-pearl
   
   # Check ExternalSecret status
   kubectl get externalsecret -n interface-pearl
   ```

### Debug Mode

Enable debug logging:

```yaml
env:
  LOG_LEVEL: "debug"
  DEBUG: "true"
  NODE_ENV: "development"
```

## 📊 Performance Tuning

### Resource Optimization

```yaml
resources:
  limits:
    memory: 2Gi
    cpu: 2000m
  requests:
    cpu: 1000m
    memory: 1Gi
```

### Horizontal Pod Autoscaling

```yaml
# Create HPA
kubectl apply -f - <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: interface-hpa
  namespace: interface-pearl
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: interface-pearl
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
EOF
```

## 🔗 Related Services

The Interface service typically integrates with:
- **Mesh**: GraphQL API for data access
- **Dashboard**: Analytics and management interface
- **Database**: PostgreSQL for data storage
- **Authentication**: NextAuth.js or similar

## 📚 Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [NextAuth.js Documentation](https://next-auth.js.org/)
- [External Secrets Operator](https://external-secrets.io/)
- [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/)

## 🤝 Support

For issues and questions:
1. Check the logs: `kubectl logs -n interface-pearl deployment/interface-pearl`
2. Review the troubleshooting section above
3. Check the External Secrets setup guide in `../scripts/EXTERNAL_SECRETS_SETUP.md`
4. Contact the Nia team at team@nia.com
