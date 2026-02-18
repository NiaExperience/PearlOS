# Mesh Helm Chart

This Helm chart deploys the Nia Universal Mesh service, which provides a GraphQL mesh for data integration and federation across multiple data sources.

## 🎯 Overview

The Mesh service acts as a GraphQL gateway that:
- Federates data from multiple sources
- Provides a unified GraphQL API
- Handles data transformation and aggregation
- Manages authentication and authorization
- Serves as the central data access layer for the Nia Universal platform

## 🚀 Quick Start

### Basic Deployment

```bash
# Deploy to pearl environment
helm install mesh-pearl ./charts/mesh \
  --namespace mesh-pearl \
  --create-namespace \
  -f ./charts/mesh/values-pearl.yaml
```

### With External Secrets

The pearl environment values file includes External Secrets Operator configuration by default.

## ⚙️ Configuration

### Default Values

The chart uses these default values:

```yaml
replicaCount: 1

image:
  repository: 577124901432.dkr.ecr.us-east-2.amazonaws.com/mesh
  tag: "latest"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 80
  targetPort: 2000  # GraphQL service port

resources:
  limits:
    memory: 384Mi
  requests:
    cpu: 100m
    memory: 192Mi
```

### Environment-Specific Values

#### Pearl Environment (`values-pearl.yaml`)

```yaml
ingress:
  enabled: true
  annotations:
    external-dns.alpha.kubernetes.io/hostname: mesh.pearl.nxops.net
  hosts:
    - host: mesh.pearl.nxops.net
      paths:
        - path: /
          pathType: Prefix

env:
  NODE_ENV: "production"
```

### Secret Management

The Mesh service supports multiple secret management approaches:

#### External Secrets Operator (Recommended)

```yaml
secret:
  enabled: true
  externalSecret:
    enabled: true
    name: "mesh-external-secret"
```

This will create an ExternalSecret that fetches from AWS Secrets Manager:
- `nia/{mesh.fullname}/database-url`
- `nia/{mesh.fullname}/api-keys`
- `nia/{mesh.fullname}/shared-secret`

#### Existing Secret

```yaml
secret:
  enabled: true
  existingSecret: "mesh-existing-secret"
```

#### Inline Data (Development Only)

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
  GRAPHQL_PORT: "2000"
  LOG_LEVEL: "info"
  CACHE_TTL: "3600"
```

### ConfigMap Data

```yaml
configMap:
  data:
    mesh-config.json: |
      {
        "federation": {
          "enabled": true,
          "endpoints": [
            "https://api1.example.com/graphql",
            "https://api2.example.com/graphql"
          ]
        },
        "caching": {
          "enabled": true,
          "ttl": 3600
        }
      }
```

### Resource Configuration

```yaml
resources:
  limits:
    memory: 512Mi
    cpu: 500m
  requests:
    cpu: 200m
    memory: 256Mi
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
    external-dns.alpha.kubernetes.io/hostname: mesh.example.com
  hosts:
    - host: mesh.example.com
      paths:
        - path: /
          pathType: Prefix
  tls: []
```

## 🔍 Monitoring and Health Checks

### Health Check Endpoint

The Mesh service exposes a health check endpoint at `/health`:

```bash
# Check service health
curl https://mesh.stg.nxops.net/health
```

### GraphQL Playground

Access the GraphQL playground at `/graphql`:

```bash
# Open in browser
open https://mesh.stg.nxops.net/graphql
```

## 🛠️ Management

### Upgrade Deployment

```bash
helm upgrade mesh-pearl ./charts/mesh \
  --namespace mesh-pearl \
  -f ./charts/mesh/values-pearl.yaml
```

### Rollback

```bash
helm rollback mesh-pearl 1 --namespace mesh-pearl
```

### View Logs

```bash
kubectl logs -n mesh-pearl deployment/mesh-pearl
kubectl logs -n mesh-pearl deployment/mesh-pearl -f  # Follow logs
```

### Check Status

```bash
kubectl get pods -n mesh-pearl
kubectl get svc -n mesh-pearl
kubectl get ingress -n mesh-pearl
```

## 🔐 Security

### Network Policies

Consider implementing network policies to restrict traffic:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: mesh-network-policy
  namespace: mesh-pearl
spec:
  podSelector:
    matchLabels:
      app: mesh-pearl
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: interface-pearl
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
    - mesh.example.com
    secretName: mesh-tls-secret
```

## 🚨 Troubleshooting

### Common Issues

1. **Service Not Responding**
   ```bash
       # Check pod status
    kubectl get pods -n mesh-pearl
    
    # Check service endpoints
    kubectl get endpoints -n mesh-pearl
    
    # Check logs
    kubectl logs -n mesh-pearl deployment/mesh-pearl
   ```

2. **GraphQL Errors**
   ```bash
   # Test GraphQL endpoint
   curl -X POST https://mesh.pearl.nxops.net/graphql \
     -H "Content-Type: application/json" \
     -d '{"query": "{ __schema { types { name } } }"}'
   ```

3. **Secret Issues**
   ```bash
   # Check if secrets are mounted
   kubectl describe pod -n mesh-pearl -l app=mesh-pearl
   
   # Check ExternalSecret status
   kubectl get externalsecret -n mesh-pearl
   ```

### Debug Mode

Enable debug logging:

```yaml
env:
  LOG_LEVEL: "debug"
  DEBUG: "true"
```

## 📊 Performance Tuning

### Resource Optimization

```yaml
resources:
  limits:
    memory: 1Gi
    cpu: 1000m
  requests:
    cpu: 500m
    memory: 512Mi
```

### Horizontal Pod Autoscaling

```yaml
# Create HPA
kubectl apply -f - <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: mesh-hpa
  namespace: mesh-pearl
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: mesh-pearl
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
EOF
```

## 🔗 Related Services

The Mesh service typically integrates with:
- **Interface**: Main web application
- **Dashboard**: Analytics and management interface
- **Database**: PostgreSQL for data storage
- **External APIs**: Various data sources

## 📚 Additional Resources

- [GraphQL Federation Documentation](https://www.apollographql.com/docs/federation/)
- [External Secrets Operator](https://external-secrets.io/)
- [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/)
- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)

## 🤝 Support

For issues and questions:
1. Check the logs: `kubectl logs -n mesh-pearl deployment/mesh-pearl`
2. Review the troubleshooting section above
3. Contact the Nia team at team@nia.com
