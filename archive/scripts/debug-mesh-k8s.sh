#!/bin/bash
# Kubernetes Debugging Commands for mesh-stg deployment
# Run these commands to diagnose the pod termination issue

set -e

NAMESPACE="mesh-stg"
APP_LABEL="mesh-stg-web"

echo "======================================"
echo "Mesh STG Kubernetes Diagnostics"
echo "======================================"
echo ""

# 1. Get pod status
echo "1️⃣  Current Pod Status:"
echo "-----------------------------------"
kubectl get pods -n "$NAMESPACE" -l app="$APP_LABEL" 2>/dev/null || {
    echo "❌ No pods found with label app=$APP_LABEL"
    echo "Listing all pods in namespace:"
    kubectl get pods -n "$NAMESPACE"
}
echo ""

# 2. Describe the most recent pod
echo "2️⃣  Pod Events & Details:"
echo "-----------------------------------"
POD_NAME=$(kubectl get pods -n "$NAMESPACE" -l app="$APP_LABEL" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -n "$POD_NAME" ]; then
    kubectl describe pod "$POD_NAME" -n "$NAMESPACE" | grep -A 30 "Events:" || echo "No events found"
else
    echo "❌ Could not find pod"
fi
echo ""

# 3. Check deployment health probe configuration
echo "3️⃣  Health Probe Configuration:"
echo "-----------------------------------"
kubectl get deployment -n "$NAMESPACE" -o yaml 2>/dev/null | grep -A 20 "Probe" || echo "❌ No deployment found"
echo ""

# 4. Get recent logs
echo "4️⃣  Current Pod Logs (last 30 lines):"
echo "-----------------------------------"
if [ -n "$POD_NAME" ]; then
    kubectl logs "$POD_NAME" -n "$NAMESPACE" --tail=30 2>/dev/null || echo "❌ Could not get logs"
else
    echo "❌ No pod to get logs from"
fi
echo ""

# 5. Get previous pod logs (from crashed container)
echo "5️⃣  Previous Pod Logs (crashed container):"
echo "-----------------------------------"
if [ -n "$POD_NAME" ]; then
    kubectl logs "$POD_NAME" -n "$NAMESPACE" --previous --tail=30 2>/dev/null || echo "ℹ️  No previous container logs (pod may not have restarted yet)"
else
    echo "❌ No pod to get logs from"
fi
echo ""

# 6. Check resource usage
echo "6️⃣  Resource Usage:"
echo "-----------------------------------"
kubectl top pod -n "$NAMESPACE" 2>/dev/null || echo "⚠️  Metrics server not available"
echo ""

# 7. Get deployment details
echo "7️⃣  Deployment Configuration:"
echo "-----------------------------------"
kubectl get deployment -n "$NAMESPACE" -o wide 2>/dev/null || echo "❌ No deployments found"
echo ""

# 8. Check ReplicaSets
echo "8️⃣  ReplicaSet Status:"
echo "-----------------------------------"
kubectl get rs -n "$NAMESPACE" 2>/dev/null || echo "❌ No replica sets found"
echo ""

echo "======================================"
echo "Diagnostic Summary"
echo "======================================"
echo ""
echo "📋 To test database connection from inside pod:"
echo "   kubectl exec -it $POD_NAME -n $NAMESPACE -- node /app/scripts/test-db-connection.js"
echo ""
echo "📋 To get full deployment YAML:"
echo "   kubectl get deployment -n $NAMESPACE -o yaml > mesh-deployment.yaml"
echo ""
echo "📋 To check configmaps:"
echo "   kubectl get configmap -n $NAMESPACE"
echo "   kubectl describe configmap mesh-stg-config -n $NAMESPACE"
echo ""
echo "📋 To check secrets:"
echo "   kubectl get secrets -n $NAMESPACE"
echo ""
echo "======================================"
