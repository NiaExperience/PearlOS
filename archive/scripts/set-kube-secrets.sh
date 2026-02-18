#!/bin/bash

# Script to apply secrets pulled by get-secrets.sh
# Usage: ./scripts/set-kube-secrets.sh [--stg|--prod]

ENV="stg"
OUTPUT_BASE="/tmp/kube/secrets"

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

SECRETS_DIR="$OUTPUT_BASE/$ENV"

echo "Setting secrets from $SECRETS_DIR (env=$ENV)..."

if [ ! -d "$SECRETS_DIR" ]; then
    echo "Error: $SECRETS_DIR directory not found!"
    echo "Please run ./scripts/get-secrets.sh --$ENV first to export secrets."
    exit 1
fi

apply_secret() {
    local namespace=$1
    local file=$2

    if [ -f "$SECRETS_DIR/$file" ]; then
        echo "Applying secrets to namespace $namespace from $file..."
        kubectl -n "$namespace" apply -f "$SECRETS_DIR/$file"
    else
        echo "Warning: $SECRETS_DIR/$file not found"
    fi
}

if [ "$ENV" == "stg" ]; then
    apply_secret "dashboard-stg" "dashboard-stg.yaml"
    apply_secret "interface-stg" "interface-stg.yaml"
    apply_secret "interface-stg" "interface-stg-basic-auth.yaml"
    apply_secret "pipecat-daily-bot-stg" "pipecat-daily-bot-stg.yaml"
    apply_secret "kokoro-tts-stg" "kokoro-tts-stg.yaml"
    apply_secret "mesh-stg" "mesh-stg.yaml"
elif [ "$ENV" == "prod" ]; then
    apply_secret "dashboard-pearl" "dashboard-pearl.yaml"
    apply_secret "interface-pearl" "interface-pearl.yaml"
    apply_secret "pipecat-daily-bot-pearl" "pipecat-daily-bot-pearl.yaml"
    apply_secret "kokoro-tts-pearl" "kokoro-tts-pearl.yaml"
    apply_secret "mesh-pearl" "mesh-pearl.yaml"
fi

echo ""
echo "Secret application completed!"
echo "To verify the applied secrets, run: ./scripts/get-secrets.sh --$ENV"
