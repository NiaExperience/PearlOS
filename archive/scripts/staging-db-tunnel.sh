#!/bin/bash
# Create a simple TCP proxy pod in Kubernetes and port-forward to it
# This gives you local access to RDS through the cluster

set -e

NAMESPACE="mesh-stg"
RDS_HOST="nia-dev.cluster-cjiyu8c46p5t.us-east-2.rds.amazonaws.com"
RDS_PORT="5432"
LOCAL_PORT="15432"
PROXY_POD="rds-proxy-temp"

echo "=========================================="
echo "RDS Proxy via Kubernetes"
echo "=========================================="
echo ""

# Check if proxy pod already exists
if kubectl get pod -n "$NAMESPACE" "$PROXY_POD" >/dev/null 2>&1; then
    echo "✅ Proxy pod already exists"
else
    echo "📦 Creating temporary proxy pod..."
    kubectl run "$PROXY_POD" -n "$NAMESPACE" \
        --image=alpine/socat:latest \
        --restart=Never \
        -- -d -d TCP-LISTEN:5432,fork,reuseaddr TCP:$RDS_HOST:$RDS_PORT
    
    echo "⏳ Waiting for pod to be ready..."
    kubectl wait --for=condition=Ready pod/"$PROXY_POD" -n "$NAMESPACE" --timeout=30s
    echo "✅ Proxy pod ready!"
fi

echo ""
echo "🚇 Starting port-forward to proxy pod..."
echo "   Local:  localhost:$LOCAL_PORT"
echo "   Remote: $RDS_HOST:$RDS_PORT"
echo ""
echo "You can now connect to:"
echo "   Host: localhost"
echo "   Port: $LOCAL_PORT"
echo ""
echo "Press Ctrl+C to stop (pod will remain for reuse)"
echo "To delete proxy pod: kubectl delete pod $PROXY_POD -n $NAMESPACE"
echo ""
echo "=========================================="
echo ""

# Start port forwarding
kubectl port-forward -n "$NAMESPACE" "pod/$PROXY_POD" "$LOCAL_PORT:5432"
