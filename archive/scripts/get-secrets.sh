#!/bin/bash

# Script to get secrets for a specific environment
# Usage: ./scripts/get-secrets.sh [--stg|--prod|--local]

ENV="stg"
OUTPUT_BASE="/tmp/kube/secrets"
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
echo "Cleaning up old secrets in $OUTPUT_DIR..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "Fetching secrets for environment: $ENV"

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

fetch_secret() {
    local ns=$1
    local secret=$2
    local file=$3
    
    echo "Fetching $secret from $ns..."
    if kubectl get secret "$secret" -n "$ns" >/dev/null 2>&1; then
        kubectl get secret "$secret" -n "$ns" -o yaml > "$OUTPUT_DIR/$file"
    else
        echo "Warning: Secret $secret not found in namespace $ns"
    fi
}

if [ "$ENV" == "stg" ]; then
    fetch_secret "dashboard-stg" "dashboard-stg-secret" "dashboard-stg.yaml"
    fetch_secret "interface-stg" "interface-stg-secret" "interface-stg.yaml"
    fetch_secret "interface-stg" "interface-stg-basic-auth" "interface-stg-basic-auth.yaml"
    fetch_secret "pipecat-daily-bot-stg" "pipecat-daily-bot-stg-secret" "pipecat-daily-bot-stg.yaml"
    fetch_secret "kokoro-tts-stg" "kokoro-tts-secrets" "kokoro-tts-stg.yaml"
    fetch_secret "mesh-stg" "mesh-stg-secret" "mesh-stg.yaml"
elif [ "$ENV" == "prod" ]; then
    fetch_secret "dashboard-pearl" "dashboard-pearl-secret" "dashboard-pearl.yaml"
    fetch_secret "interface-pearl" "interface-pearl-secret" "interface-pearl.yaml"
    fetch_secret "pipecat-daily-bot-pearl" "pipecat-daily-bot-pearl-secret" "pipecat-daily-bot-pearl.yaml"
    fetch_secret "kokoro-tts-pearl" "kokoro-tts-secrets" "kokoro-tts-pearl.yaml"
    fetch_secret "mesh-pearl" "mesh-pearl-secret" "mesh-pearl.yaml"
elif [ "$ENV" == "local" ]; then
    echo "Fetching all secrets from current context..."
    kubectl get secrets -o yaml > "$OUTPUT_DIR/local-secrets.yaml"
fi

echo ""
echo "Secrets have been saved to $OUTPUT_DIR:"
ls -lh "$OUTPUT_DIR"
