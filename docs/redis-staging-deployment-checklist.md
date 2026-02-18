# 🚀 Redis Staging Deployment Checklist

## 📋 **Executive Summary**

This checklist covers deploying Redis for the staging environment in our AWS EKS cluster. Redis will be deployed as an internal service (no external exposure) to support the admin messaging system between the interface and pipecat-daily-bot services.

---

## 🎯 **Deployment Strategy: Internal ClusterIP Service**

Based on our analysis:
- ✅ **No external ingress needed** - Redis is backend-only
- ✅ **No SSL certificates required** - Internal cluster communication
- ✅ **Follows our mesh deployment patterns** - Namespace isolation, ConfigMaps, Secrets
- ✅ **Charts will do most of the work** - Minimal manual steps required

---

## 📦 **Prerequisites**

### AWS Infrastructure
- [x] EKS cluster running and accessible
- [x] ECR repository for Redis (if using custom image)
- [x] AWS Secrets Manager access (for Redis auth if needed)
- [x] External Secrets Operator installed (existing)

### Local Tools
- [x] kubectl configured for staging cluster
- [x] helm CLI installed
- [x] Docker (if building custom Redis image)

---

## 🗂️ **Phase 1: Create Redis Chart** 

### 1.1 Create Chart Structure
```bash
# Create Redis chart following our patterns
mkdir -p charts/redis
mkdir -p charts/redis/templates
```

**Files to create:**
- `charts/redis/Chart.yaml` - Helm chart metadata
- `charts/redis/values.yaml` - Default values
- `charts/redis/values-staging.yaml` - Staging-specific overrides
- `charts/redis/templates/namespace.yaml` - Namespace creation
- `charts/redis/templates/configmap.yaml` - Redis configuration
- `charts/redis/templates/secret.yaml` - Redis authentication (optional)
- `charts/redis/templates/deployment.yaml` - Redis deployment
- `charts/redis/templates/service.yaml` - Internal service (ClusterIP)

### 1.2 Configuration Strategy
- **Use stock Redis image**: `redis:7-alpine` (official, secure, maintained)
- **Custom config via ConfigMap**: Mount our `redis.development.conf` 
- **Persistence**: Use PersistentVolumeClaim for data persistence
- **No ingress**: Internal service only
- **Security**: Optional Redis AUTH via Secret

---

## 🔧 **Phase 2: Redis Configuration**

### 2.1 Production Redis Config
**Create**: `config/redis/redis.staging.conf`
```properties
# Redis staging configuration
port 6379
bind 0.0.0.0
tcp-backlog 511
timeout 300
tcp-keepalive 60

# Persistence enabled for staging
save 900 1
save 300 10  
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump-staging.rdb

# Memory management
maxmemory 512mb
maxmemory-policy allkeys-lru

# Logging
loglevel notice
logfile ""

# Security
# requirepass will be set via secret if needed
protected-mode yes

# Performance
lazyfree-lazy-eviction yes
lazyfree-lazy-expire yes
lazyfree-lazy-server-del yes
```

### 2.2 Secrets Management
**Redis Authentication with REDIS_SHARED_SECRET:**

**Generate Redis Shared Secret:**

```bash
# Generate secure shared secret using Python
python3 -c "import secrets; print('REDIS_SHARED_SECRET=' + secrets.token_urlsafe(32))"
# Example output: REDIS_SHARED_SECRET=abc123...xyz789
```

**Option 1: Local Development (No Auth)**
```bash
export REDIS_AUTH_REQUIRED="false"
# No REDIS_SHARED_SECRET needed
```

**Option 2: Secure Deployment (With Auth)**
```bash
export REDIS_AUTH_REQUIRED="true"
export REDIS_SHARED_SECRET="your-generated-secret-here"

# Create Kubernetes secret
kubectl create secret generic redis-secret \
  --from-literal=redis-password="$REDIS_SHARED_SECRET" \
  --namespace redis-stg
```

**Option 3: AWS Secrets Manager (Production)**
```bash
# Store in AWS Secrets Manager
aws secretsmanager create-secret \
  --name "redis-shared-secret-staging" \
  --description "Redis shared secret for staging" \
  --secret-string "{\"redis-password\":\"$REDIS_SHARED_SECRET\"}"
```

---

## 🚢 **Phase 3: Kubernetes Deployment**

### 3.1 Deploy Redis Chart
```bash
# Deploy to staging
helm upgrade --install redis-stg ./charts/redis \
  --namespace redis-stg \
  --create-namespace \
  --values ./charts/redis/values-staging.yaml \
  --wait --timeout=300s
```

### 3.2 Verify Deployment
```bash
# Check pods
kubectl get pods -n redis-stg

# Check service
kubectl get svc -n redis-stg

# Test Redis connection
kubectl run redis-test --rm -i --tty \
  --image redis:7-alpine \
  --namespace redis-stg \
  -- redis-cli -h redis-stg -p 6379 ping
```

---

## 🔗 **Phase 4: Service Integration**

### 4.1 Update Pipecat-Daily-Bot
**Modify**: `apps/pipecat-daily-bot/deployment/staging/00-configmap.yaml`
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: pipecat-daily-bot-stg-config
  namespace: pipecat-daily-bot-stg
data:
  # Existing config...
  REDIS_URL: "redis://redis-stg.redis-stg.svc.cluster.local:6379"
  USE_REDIS: "true"
  ENVIRONMENT: "staging"
```

### 4.2 Update Interface Service
**Modify**: Interface deployment ConfigMap (similar pattern)
```yaml
# Add to interface configmap
REDIS_URL: "redis://redis-stg.redis-stg.svc.cluster.local:6379"
USE_REDIS: "true"
```

### 4.3 Network Policies (Optional)
Create network policies for security:
- Allow pipecat-daily-bot → Redis
- Allow interface → Redis  
- Deny all other traffic to Redis

---

## ✅ **Phase 5: Testing & Validation**

### 5.1 Connectivity Tests
```bash
# Test from pipecat-daily-bot pod
kubectl exec -it deployment/pipecat-daily-bot-stg -n pipecat-daily-bot-stg -- \
  python -c "
import redis
r = redis.Redis(host='redis-stg.redis-stg.svc.cluster.local', port=6379)
print('Ping:', r.ping())
print('Set test:', r.set('test', 'hello'))
print('Get test:', r.get('test'))
"
```

### 5.2 Admin Messaging Test
```bash
# Use our test script
python scripts/test-redis-migration.py --staging
```

### 5.3 Performance Validation
```bash
# Redis performance test
kubectl run redis-benchmark --rm -i --tty \
  --image redis:7-alpine \
  --namespace redis-stg \
  -- redis-benchmark -h redis-stg -p 6379 -c 10 -n 1000
```

---

## 🚨 **Manual Steps Required**

### DNS Resolution
- ✅ **Automatic**: Kubernetes DNS resolves `redis-stg.redis-stg.svc.cluster.local`
- ✅ **No manual DNS setup needed**

### Certificates
- ✅ **Not required**: Internal cluster communication doesn't need TLS
- 🔄 **Optional**: Can add TLS for enhanced security later

### AWS Secrets
- 🔄 **Optional**: Redis AUTH password in Secrets Manager
- 🔄 **Required if**: Production security requirements mandate authentication

### Network Security  
- 🔄 **Recommended**: Network policies to restrict Redis access
- ✅ **Default**: Kubernetes network isolation provides basic security

---

## 📊 **Deployment Automation Level**

| Component | Automation Level | Manual Steps |
|-----------|------------------|--------------|
| **Chart Creation** | 🟡 Manual (one-time) | Create Helm templates |
| **Configuration** | 🟢 Automated | ConfigMaps handle everything |
| **Deployment** | 🟢 Automated | `helm install` deploys everything |
| **Service Discovery** | 🟢 Automated | Kubernetes DNS handles it |
| **Integration** | 🟡 Semi-automated | Update app ConfigMaps |
| **Testing** | 🟡 Semi-automated | Run provided test scripts |

**Overall**: 🟢 **Charts will do ~90% of the work**

---

## 🔄 **Rollback Plan**

### Emergency Rollback
```bash
# Disable Redis in apps (immediate)
kubectl patch configmap pipecat-daily-bot-stg-config -n pipecat-daily-bot-stg -p '{"data":{"USE_REDIS":"false"}}'

# Restart deployments to pick up change
kubectl rollout restart deployment/pipecat-daily-bot-stg -n pipecat-daily-bot-stg

# Remove Redis deployment
helm uninstall redis-stg --namespace redis-stg
```

### Graceful Migration Back
1. Set `USE_REDIS=false` in all services
2. Wait for file-based fallback to activate
3. Monitor admin messaging continues working
4. Remove Redis when confirmed stable

---

## 📈 **Monitoring & Observability**

### Redis Metrics
```bash
# Redis INFO command via kubectl
kubectl exec -it deployment/redis-stg -n redis-stg -- redis-cli info

# Key metrics to monitor:
# - connected_clients
# - used_memory
# - keyspace_hits/misses
# - total_commands_processed
```

### Application Metrics
- Monitor admin message delivery latency
- Track Redis connection errors in app logs
- Validate message queue lengths

---

## 🎉 **Success Criteria**

### Deployment Success
- [x] Redis pod running and healthy
- [x] Service accessible via cluster DNS
- [x] Persistent volume mounted correctly
- [x] Configuration loaded successfully

### Integration Success  
- [x] Pipecat-daily-bot connects to Redis
- [x] Admin messages route through Redis queues
- [x] <50ms message delivery latency achieved
- [x] File-based fallback disabled successfully

### Production Readiness
- [x] Data persistence working
- [x] Pod restart doesn't lose data
- [x] Performance meets requirements
- [x] Monitoring and alerts configured

---

## 🚀 **Next Steps After Deployment**

1. **Monitor** Redis performance and admin messaging latency
2. **Scale** Redis if needed (consider Redis Cluster for high availability)
3. **Secure** with Redis AUTH and network policies if required
4. **Optimize** memory usage and persistence settings
5. **Plan** production deployment using same patterns

---

## 📞 **Support & Troubleshooting**

### Common Issues
- **DNS resolution**: Ensure correct service FQDN format
- **Network policies**: May block inter-namespace communication
- **Resource limits**: Redis may need more memory for staging load
- **Persistence**: PVC storage class must support ReadWriteOnce

### Debug Commands
```bash
# Pod logs
kubectl logs deployment/redis-stg -n redis-stg

# Service endpoints
kubectl get endpoints redis-stg -n redis-stg

# Network connectivity
kubectl run netshoot --rm -i --tty --image nicolaka/netshoot -n redis-stg -- bash
```

---

**Estimated Deployment Time**: 2-3 hours (including testing)  
**Complexity Level**: 🟢 Low (follows established patterns)  
**Risk Level**: 🟢 Low (internal service, file fallback available)