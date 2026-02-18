#!/bin/bash

# Script to get configmaps for a specific environment
# Usage: ./scripts/get-configmaps.sh [--stg|--prod|--local]

set -euo pipefail

ENV="stg"
OUTPUT_BASE="/tmp/kube/configmaps"
ORIGINAL_CONTEXT=""
SWITCHED_CONTEXT=false

# Restore the user's kube context when we exit, if we switched it.
cleanup_context() {
    if [ "$SWITCHED_CONTEXT" = true ] && [ -n "$ORIGINAL_CONTEXT" ]; then
        kubectl config use-context "$ORIGINAL_CONTEXT" >/dev/null 2>&1 || true
    fi
}

trap cleanup_context EXIT

while [[ $# -gt 0 ]]; do
    case $1 in
        --prod)
            ENV="prod"
            shift
            ;;
        --local)
            ENV="local"
            shift
            ;;
        --stg)
            ENV="stg"
            shift
            ;;
        *)
            echo "Unknown argument: $1"
            exit 1
            ;;
    esac
done

OUTPUT_DIR="$OUTPUT_BASE/$ENV"
echo "Cleaning up old configmaps in $OUTPUT_DIR..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "Fetching configmaps for environment: $ENV"

# For staging/prod, temporarily switch kube context to the shared EKS cluster
if [ "$ENV" = "stg" ] || [ "$ENV" = "prod" ]; then
    ORIGINAL_CONTEXT=$(kubectl config current-context 2>/dev/null || true)
    TARGET_CONTEXT="arn:aws:eks:us-east-2:577124901432:cluster/nia"
    if kubectl config use-context "$TARGET_CONTEXT" >/dev/null 2>&1; then
        SWITCHED_CONTEXT=true
        echo "Switched kubectl context to EKS cluster"
    else
        echo "Warning: failed to switch kubectl context to $TARGET_CONTEXT. Continuing with current context: ${ORIGINAL_CONTEXT:-unknown}" >&2
    fi
fi

fetch_cm() {
    local ns=$1
    local cm=$2
    local file=$3
    
    echo "Fetching $cm from $ns..."
    if kubectl get configmap "$cm" -n "$ns" >/dev/null 2>&1; then
        kubectl get configmap "$cm" -n "$ns" -o yaml > "$OUTPUT_DIR/$file"
    else
        echo "Warning: ConfigMap $cm not found in namespace $ns"
    fi
}

fetch_all_cm() {
    local ns=$1
    local file=$2
    
    echo "Fetching all configmaps from $ns..."
    kubectl get configmap -n "$ns" -o yaml > "$OUTPUT_DIR/$file"
}

if [ "$ENV" == "stg" ]; then
    # Targeted fetches for key configmaps we know we need
    fetch_cm "dashboard-stg" "dashboard-stg-config" "dashboard-stg-configmap.yaml"
    fetch_cm "interface-stg" "interface-stg-config" "interface-stg-configmap.yaml"
    fetch_cm "interface-stg" "interface-stg-nginx-conf" "interface-stg-nginx-configmap.yaml"
    fetch_cm "pipecat-daily-bot-stg" "pipecat-daily-bot-stg-config" "pipecat-daily-bot-stg-configmap.yaml"
    fetch_cm "kokoro-tts-stg" "kokoro-tts-stg-config" "kokoro-tts-stg-configmap.yaml"
    fetch_cm "mesh-stg" "mesh-stg-config" "mesh-stg-configmap.yaml"
    # Catch-all dumps disabled to avoid extra noise and large files
    # for ns in dashboard-stg interface-stg pipecat-daily-bot-stg kokoro-tts-stg mesh-stg redis-stg; do
    #     fetch_all_cm "$ns" "$ns-all-configmaps.yaml"
    # done
elif [ "$ENV" == "prod" ]; then
    fetch_cm "dashboard-pearl" "dashboard-pearl-config" "dashboard-pearl-configmap.yaml"
    fetch_cm "interface-pearl" "interface-pearl-config" "interface-pearl-configmap.yaml"
    fetch_cm "pipecat-daily-bot-pearl" "pipecat-daily-bot-pearl-config" "pipecat-daily-bot-pearl-configmap.yaml"
    fetch_cm "kokoro-tts-pearl" "kokoro-tts-pearl-config" "kokoro-tts-pearl-configmap.yaml"
    fetch_cm "mesh-pearl" "mesh-pearl-config" "mesh-pearl-configmap.yaml"
    # Catch-all dumps disabled to avoid extra noise and large files
    # for ns in dashboard-pearl interface-pearl pipecat-daily-bot-pearl kokoro-tts-pearl mesh-pearl redis-pearl; do
    #     fetch_all_cm "$ns" "$ns-all-configmaps.yaml"
    # done
elif [ "$ENV" == "local" ]; then
    echo "Fetching all configmaps from current context..."
    kubectl get configmaps -A -o yaml > "$OUTPUT_DIR/local-configmaps.yaml"
fi

echo ""
echo "ConfigMaps have been saved to $OUTPUT_DIR:"
ls -lh "$OUTPUT_DIR"
