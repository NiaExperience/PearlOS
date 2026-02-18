#!/bin/bash

# Script to apply configmaps pulled by get-configmaps.sh
# Usage: ./scripts/set-kube-configmaps.sh [--stg|--prod]

ENV="stg"
OUTPUT_BASE="/tmp/kube/configmaps"

while [[ $# -gt 0 ]]; do
    case $1 in
        --prod)
            ENV="prod"
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

CONFIGMAP_DIR="$OUTPUT_BASE/$ENV"

echo "Setting configmaps from $CONFIGMAP_DIR (env=$ENV)..."

if [ ! -d "$CONFIGMAP_DIR" ]; then
    echo "Error: $CONFIGMAP_DIR directory not found!"
    echo "Please run ./scripts/get-configmaps.sh --$ENV first to export configmaps."
    exit 1
fi

apply_cm() {
    local namespace=$1
    local file=$2

    if [ -f "$CONFIGMAP_DIR/$file" ]; then
        echo "Applying configmaps to namespace $namespace from $file..."
        kubectl -n "$namespace" apply -f "$CONFIGMAP_DIR/$file"
    else
        echo "Warning: $CONFIGMAP_DIR/$file not found"
    fi
}

if [ "$ENV" == "stg" ]; then
    apply_cm "dashboard-stg" "dashboard-stg-configmap.yaml"
    apply_cm "interface-stg" "interface-stg-configmap.yaml"
    apply_cm "interface-stg" "interface-stg-nginx-configmap.yaml"
    apply_cm "pipecat-daily-bot-stg" "pipecat-daily-bot-stg-configmap.yaml"
    apply_cm "kokoro-tts-stg" "kokoro-tts-stg-configmap.yaml"
    apply_cm "mesh-stg" "mesh-stg-configmap.yaml"
elif [ "$ENV" == "prod" ]; then
    apply_cm "dashboard-pearl" "dashboard-pearl-configmap.yaml"
    apply_cm "interface-pearl" "interface-pearl-configmap.yaml"
    apply_cm "pipecat-daily-bot-pearl" "pipecat-daily-bot-pearl-configmap.yaml"
    apply_cm "kokoro-tts-pearl" "kokoro-tts-pearl-configmap.yaml"
    apply_cm "mesh-pearl" "mesh-pearl-configmap.yaml"
fi

echo ""
echo "ConfigMap application completed!"
echo "To verify the applied configmaps, run: ./scripts/get-configmaps.sh --$ENV"
