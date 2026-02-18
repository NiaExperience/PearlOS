# Helm Chart Deployment Guide: Dashboard & Interface

## Prerequisites ✅

Before deploying, ensure you have:

1. **Helm installed** and configured
2. **kubectl** connected to the correct cluster
3. **Docker images** built and pushed to ECR
4. **Secrets and ConfigMaps** exist in the target namespaces

## Quick Verification

```bash
# Check Helm version
helm version

# Check kubectl connectivity
kubectl cluster-info

# Check current deployments
kubectl get deployments -n dashboard-stg
kubectl get deployments -n interface-stg
```

## Step 1: Prepare for Deployment

### Check Current State
```bash
# See what's currently running
kubectl get all -n dashboard-stg
kubectl get all -n interface-stg

# Check existing secrets and configmaps
kubectl get secrets -n dashboard-stg
kubectl get configmaps -n dashboard-stg
kubectl get secrets -n interface-stg  
kubectl get configmaps -n interface-stg
```

### Create Staging Values Files (Optional)
You can override default values by creating staging-specific values files:

```bash
# Create staging values for dashboard
cat > /tmp/dashboard-staging.yaml << EOF
image:
  tag: "v1.0.0"  # Replace with your specific tag

# Override any staging-specific settings
replicaCount: 1

# Ensure we use existing secrets
secret:
  enabled: true
  existingSecret: "dashboard-stg-secret"

configMap:
  data:
    NODE_ENV: "staging"
    # Add other staging-specific config
EOF

# Create staging values for interface  
cat > /tmp/interface-staging.yaml << EOF
image:
  tag: "v1.0.0"  # Replace with your specific tag

# Override any staging-specific settings
replicaCount: 1

# Ensure we use existing secrets
secret:
  enabled: true
  existingSecret: "interface-stg-secret"

# Enable auth proxy for interface
authProxy:
  enabled: true

configMap:
  data:
    NODE_ENV: "staging"
    # Add other staging-specific config
EOF
```

## Step 2: Deploy Dashboard

### Option A: Deploy with Default Values
```bash
# Deploy dashboard using default chart values
helm upgrade --install dashboard-stg charts/dashboard \
  --namespace dashboard-stg \
  --create-namespace \
  --wait \
  --timeout 300s
```

### Option B: Deploy with Custom Values
```bash
# Deploy dashboard with custom staging values
helm upgrade --install dashboard-stg charts/dashboard \
  --namespace dashboard-stg \
  --create-namespace \
  --values /tmp/dashboard-staging.yaml \
  --wait \
  --timeout 300s
```

### Option C: Deploy with Inline Overrides
```bash
# Deploy dashboard with specific image tag
helm upgrade --install dashboard-stg charts/dashboard \
  --namespace dashboard-stg \
  --create-namespace \
  --set image.tag=latest \
  --set secret.existingSecret=dashboard-stg-secret \
  --wait \
  --timeout 300s
```

## Step 3: Deploy Interface

### Option A: Deploy with Default Values
```bash
# Deploy interface using default chart values
helm upgrade --install interface-stg charts/interface \
  --namespace interface-stg \
  --create-namespace \
  --wait \
  --timeout 300s
```

### Option B: Deploy with Custom Values
```bash
# Deploy interface with custom staging values
helm upgrade --install interface-stg charts/interface \
  --namespace interface-stg \
  --create-namespace \
  --values /tmp/interface-staging.yaml \
  --wait \
  --timeout 300s
```

### Option C: Deploy with Inline Overrides
```bash
# Deploy interface with specific image tag
helm upgrade --install interface-stg charts/interface \
  --namespace interface-stg \
  --create-namespace \
  --set image.tag=latest \
  --set secret.existingSecret=interface-stg-secret \
  --wait \
  --timeout 300s
```

## Step 4: Verify Deployments

### Check Deployment Status
```bash
# Check dashboard deployment
helm status dashboard-stg -n dashboard-stg
kubectl get all -n dashboard-stg
kubectl describe deployment dashboard-stg -n dashboard-stg

# Check interface deployment  
helm status interface-stg -n interface-stg
kubectl get all -n interface-stg
kubectl describe deployment interface-stg -n interface-stg
```

### Test Health Endpoints
```bash
# Test dashboard health (through ingress)
curl -I https://dashboard.stg.nxops.net/health

# Test interface health (through ingress)  
curl -I https://interface.stg.nxops.net/health

# Test health endpoints directly (port-forward if needed)
kubectl port-forward -n dashboard-stg svc/dashboard-stg 8080:80 &
curl http://localhost:8080/health

kubectl port-forward -n interface-stg svc/interface-stg 8081:80 &
curl http://localhost:8081/health
```

### Check Health Probes
```bash
# Verify health probes are working
kubectl describe pods -n dashboard-stg | grep -A 10 "Liveness\|Readiness"
kubectl describe pods -n interface-stg | grep -A 10 "Liveness\|Readiness"

# Check for probe failures
kubectl get events -n dashboard-stg --field-selector reason=Unhealthy
kubectl get events -n interface-stg --field-selector reason=Unhealthy
```

## Step 5: Monitor Rollout

### Watch Pod Status
```bash
# Watch dashboard pods
kubectl get pods -n dashboard-stg -w

# Watch interface pods
kubectl get pods -n interface-stg -w
```

### Check Logs
```bash
# Dashboard logs
kubectl logs -n dashboard-stg deployment/dashboard-stg -f

# Interface logs (auth-proxy container)
kubectl logs -n interface-stg deployment/interface-stg -c auth-proxy -f

# Interface logs (web container)
kubectl logs -n interface-stg deployment/interface-stg -c web -f
```

## Troubleshooting Common Issues

### Issue: Pods Not Starting
```bash
# Check pod status and events
kubectl describe pods -n dashboard-stg
kubectl describe pods -n interface-stg

# Check for image pull issues
kubectl get events -n dashboard-stg --sort-by='.lastTimestamp'
kubectl get events -n interface-stg --sort-by='.lastTimestamp'
```

### Issue: Health Checks Failing
```bash
# Check if health endpoints are responding
kubectl exec -n dashboard-stg deployment/dashboard-stg -- curl -f http://localhost:4000/health
kubectl exec -n interface-stg deployment/interface-stg -c web -- curl -f http://localhost:3000/health
```

### Issue: Ingress/ALB Not Working
```bash
# Check ingress status
kubectl describe ingress -n dashboard-stg
kubectl describe ingress -n interface-stg

# Check ALB annotations
kubectl get ingress -n dashboard-stg -o yaml | grep -A 5 annotations
kubectl get ingress -n interface-stg -o yaml | grep -A 5 annotations
```

## Rollback if Needed

### Quick Rollback
```bash
# Rollback dashboard to previous version
helm rollback dashboard-stg -n dashboard-stg

# Rollback interface to previous version  
helm rollback interface-stg -n interface-stg
```

### Rollback to Specific Version
```bash
# List release history
helm history dashboard-stg -n dashboard-stg
helm history interface-stg -n interface-stg

# Rollback to specific revision
helm rollback dashboard-stg 1 -n dashboard-stg
helm rollback interface-stg 1 -n interface-stg
```

## Clean Slate Deployment (If Needed)

If you want to completely replace existing deployments:

```bash
# Remove existing deployments (if needed)
helm uninstall dashboard-stg -n dashboard-stg
helm uninstall interface-stg -n interface-stg

# Wait for cleanup
kubectl wait --for=delete pods --all -n dashboard-stg --timeout=300s
kubectl wait --for=delete pods --all -n interface-stg --timeout=300s

# Deploy fresh
helm install dashboard-stg charts/dashboard --namespace dashboard-stg --create-namespace
helm install interface-stg charts/interface --namespace interface-stg --create-namespace
```

## Recommended Next Steps

1. **Start with Dashboard** (simpler single-container deployment)
2. **Verify health checks work** before proceeding to interface
3. **Deploy Interface** (confirm single `web` container rollout)
4. **Test end-to-end** functionality
5. **Monitor for 15-30 minutes** to ensure stability

## Interface Pearl Cleanup (No Nginx Proxy)

Use the refreshed Helm chart to align the production `interface-pearl` release with the single-container deployment already running in staging.

1. **Pre-checks**
   ```bash
   # ConfigMap referenced by the chart
   kubectl get configmap interface-pearl-config -n interface-pearl

   # ExternalSecret must be healthy before the rollout
   kubectl get externalsecret interface-pearl-external-secret -n interface-pearl
   ```
2. **Dry-run the upgrade** (release metadata lives in the `default` namespace)
   ```bash
   helm upgrade --install interface-pearl charts/interface \
     --namespace default \
     -f charts/interface/values-pearl.yaml \
     --dry-run --create-namespace
   ```
3. **Apply the upgrade**
   ```bash
   helm upgrade --install interface-pearl charts/interface \
     --namespace default \
     -f charts/interface/values-pearl.yaml \
     --create-namespace
   ```
4. **Verify the rollout**
   ```bash
   kubectl rollout status deployment/interface-pearl -n interface-pearl
   kubectl get pods -n interface-pearl
   kubectl describe service interface-pearl -n interface-pearl | grep -E 'TargetPort|Port:'
   ```

Expect a single `web` container listening on port `3000` with no auth-proxy volumes. If the rollout misbehaves, capture `kubectl describe pod` output and execute `helm rollback interface-pearl <REVISION> -n default`.

## Production Considerations

- **Use specific image tags** instead of `latest` for production
- **Set resource limits** appropriately for your environment
- **Configure horizontal pod autoscaling** if needed
- **Set up monitoring** for the new health check endpoints
- **Update any external monitoring** to use the new `/health` endpoints
