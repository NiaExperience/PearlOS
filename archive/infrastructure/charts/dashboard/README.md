# Dashboard Helm Chart

This Helm chart deploys the Nia Universal Dashboard service, which provides analytics, monitoring, and management capabilities for the Nia Universal platform.

## 🎯 Overview

The Dashboard service provides:
- **Analytics Dashboard**: Real-time metrics and insights
- **User Management**: Admin interface for user management
- **System Monitoring**: Health checks and performance metrics
- **Configuration Management**: Centralized configuration interface
- **Reporting**: Data visualization and reporting tools

## 🚀 Quick Start

### Basic Deployment

```bash
# Deploy to pearl environment
helm install dashboard-pearl ./charts/dashboard \
  --namespace dashboard-pearl \
  --create-namespace \
  -f ./charts/dashboard/values-pearl.yaml
```

### With External Secrets

The pearl environment values file includes External Secrets Operator configuration by default.

## ⚙️ Configuration

### Default Values

The chart uses these default values:

```yaml
replicaCount: 1

image:
  repository: 577124901432.dkr.ecr.us-east-2.amazonaws.com/dashboard
  tag: "latest"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 80
  targetPort: 4000  # Dashboard service port

resources:
  limits:
    memory: 512Mi
  requests:
    cpu: 150m
    memory: 256Mi
```

### Environment-Specific Values

#### Pearl Environment (`values-pearl.yaml`)

```yaml
ingress:
  enabled: true
  annotations:
    external-dns.alpha.kubernetes.io/hostname: dashboard.pearl.nxops.net
  hosts:
    - host: dashboard.pearl.nxops.net
      paths:
        - path: /
          pathType: Prefix

env:
  NODE_ENV: "production"
  API_BASE_URL: "https://mesh.pearl.nxops.net"
```

### Secret Management

The Dashboard service supports multiple secret management approaches:

#### External Secrets Operator (Recommended)

```yaml
secret:
  enabled: true
  externalSecret:
    enabled: true
    name: "dashboard-external-secret"
```

This will create an ExternalSecret that fetches from AWS Secrets Manager:
- `nia/{dashboard.fullname}/database-url`
- `nia/{dashboard.fullname}/jwt-secret`
- `nia/{dashboard.fullname}/admin-credentials`
- `nia/{dashboard.fullname}/api-keys`

#### Existing Secret

```yaml
secret:
  enabled: true
  existingSecret: "dashboard-existing-secret"
```

#### Inline Data (Development Only)

```yaml
secret:
  enabled: true
  data:
    DATABASE_URL: "base64-encoded-value"
    JWT_SECRET: "base64-encoded-value"
```

## 🔧 Advanced Configuration

### Custom Environment Variables

```yaml
env:
  NODE_ENV: "production"
  PORT: "4000"
  LOG_LEVEL: "info"
  API_BASE_URL: "https://mesh.example.com"
  ENABLE_ANALYTICS: "true"
  ENABLE_MONITORING: "true"
  SESSION_SECRET: "your-session-secret"
```

### ConfigMap Data

```yaml
configMap:
  data:
    dashboard-config.json: |
      {
        "analytics": {
          "enabled": true,
          "provider": "google-analytics",
          "trackingId": "GA-XXXXXXXXX"
        },
        "monitoring": {
          "enabled": true,
          "endpoints": [
            "https://mesh.example.com/health",
            "https://interface.example.com/health"
          ]
        },
        "features": {
          "userManagement": true,
          "systemMonitoring": true,
          "reporting": true
        }
      }
```

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
    external-dns.alpha.kubernetes.io/hostname: dashboard.example.com
  hosts:
    - host: dashboard.example.com
      paths:
        - path: /
          pathType: Prefix
  tls: []
```

## 🔍 Monitoring and Health Checks

### Health Check Endpoint

The Dashboard service exposes a health check endpoint at `/health`:

```bash
# Check service health
curl https://dashboard.stg.nxops.net/health
```

### Metrics Endpoint

Access metrics at `/metrics`:

```bash
# Get dashboard metrics
curl https://dashboard.stg.nxops.net/metrics
```

### Admin Interface

Access the admin interface at `/admin`:

```bash
# Open in browser
open https://dashboard.stg.nxops.net/admin
```

## 🛠️ Management

### Upgrade Deployment

```bash
helm upgrade dashboard-pearl ./charts/dashboard \
  --namespace dashboard-pearl \
  -f ./charts/dashboard/values-pearl.yaml
```

### Rollback

```bash
helm rollback dashboard-pearl 1 --namespace dashboard-pearl
```

### View Logs

```bash
kubectl logs -n dashboard-pearl deployment/dashboard-pearl
kubectl logs -n dashboard-pearl deployment/dashboard-pearl -f  # Follow logs
```

### Check Status

```bash
kubectl get pods -n dashboard-pearl
kubectl get svc -n dashboard-pearl
kubectl get ingress -n dashboard-pearl
```

## 🔐 Security

### Authentication

The Dashboard supports multiple authentication methods:

#### Basic Authentication

```yaml
basicAuth:
  enabled: true
  username: "admin"
  password: "secure-password"
```

#### OAuth Integration

```yaml
env:
  OAUTH_ENABLED: "true"
  OAUTH_CLIENT_ID: "your-oauth-client-id"
  OAUTH_CLIENT_SECRET: "your-oauth-client-secret"
  OAUTH_AUTHORIZATION_URL: "https://auth.example.com/oauth/authorize"
  OAUTH_TOKEN_URL: "https://auth.example.com/oauth/token"
```

### Network Policies

Consider implementing network policies to restrict access:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: dashboard-network-policy
  namespace: dashboard-pearl
spec:
  podSelector:
    matchLabels:
      app: dashboard-pearl
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
      port: 3000
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          name: mesh-pearl
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
    - dashboard.example.com
    secretName: dashboard-tls-secret
```

## 📊 Analytics and Monitoring

### Built-in Metrics

The Dashboard collects and displays:
- **System Metrics**: CPU, memory, disk usage
- **Application Metrics**: Request rates, response times, error rates
- **User Metrics**: Active users, session duration, feature usage
- **Business Metrics**: Custom KPIs and business indicators

### Integration with External Monitoring

```yaml
env:
  PROMETHEUS_ENABLED: "true"
  PROMETHEUS_ENDPOINT: "http://prometheus:9090"
  GRAFANA_ENABLED: "true"
  GRAFANA_URL: "https://grafana.example.com"
```

## 🚨 Troubleshooting

### Common Issues

1. **Dashboard Not Loading**
   ```bash
       # Check pod status
    kubectl get pods -n dashboard-pearl
    
    # Check service endpoints
    kubectl get endpoints -n dashboard-pearl
    
    # Check logs
    kubectl logs -n dashboard-pearl deployment/dashboard-pearl
   ```

2. **Authentication Issues**
   ```bash
   # Check secret configuration
   kubectl describe pod -n dashboard-pearl -l app=dashboard-pearl
   
   # Verify secret exists
   kubectl get secret -n dashboard-pearl
   ```

3. **API Connection Issues**
   ```bash
   # Test API connectivity
   curl -X GET https://mesh.pearl.nxops.net/health
   
   # Check network policies
   kubectl get networkpolicy -n dashboard-pearl
   ```

### Debug Mode

Enable debug logging:

```yaml
env:
  LOG_LEVEL: "debug"
  DEBUG: "true"
  NODE_ENV: "development"
```

## 📈 Performance Tuning

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
  name: dashboard-hpa
  namespace: dashboard-pearl
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: dashboard-pearl
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

### Caching Configuration

```yaml
env:
  CACHE_ENABLED: "true"
  CACHE_TTL: "3600"
  REDIS_URL: "redis://redis:6379"
```

## 🔗 Related Services

The Dashboard service typically integrates with:
- **Interface**: Main web application
- **Mesh**: GraphQL API for data access
- **Database**: PostgreSQL for data storage
- **Redis**: Caching layer
- **Monitoring**: Prometheus, Grafana, etc.

## 📚 Additional Resources

- [Dashboard Documentation](https://docs.example.com/dashboard)
- [Analytics Integration](https://docs.example.com/analytics)
- [External Secrets Operator](https://external-secrets.io/)
- [Kubernetes Monitoring](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-usage-monitoring/)

## 🤝 Support

For issues and questions:
1. Check the logs: `kubectl logs -n dashboard-pearl deployment/dashboard-pearl`
2. Review the troubleshooting section above
3. Check the analytics configuration
4. Contact the Nia team at team@nia.com
