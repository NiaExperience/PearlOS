#!/bin/bash

# Master script to collect all data (configmaps, secrets, logs) for a specific environment
# Usage: ./scripts/get-all.sh [--stg|--prod|--local] [--cloudwatch] [-t seconds] [seconds]

# Default environment
ENV="stg"
# Arguments to pass to get-logs.sh
LOG_ARGS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        --prod)
            ENV="prod"
            LOG_ARGS+=("--prod")
            shift
            ;;
        --local)
            ENV="local"
            LOG_ARGS+=("--local")
            shift
            ;;
        --stg)
            ENV="stg"
            LOG_ARGS+=("--stg")
            shift
            ;;
        --cloudwatch)
            LOG_ARGS+=("--cloudwatch")
            shift
            ;;
        -t|--timespan)
            LOG_ARGS+=("-t" "$2")
            shift 2
            ;;
        *[0-9]*)
            LOG_ARGS+=("$1")
            shift
            ;;
        *)
            echo "Unknown argument: $1"
            exit 1
            ;;
    esac
done

echo "========================================================"
echo "Starting full data collection for environment: $ENV"
echo "========================================================"

echo ""
echo ">>> Step 1: Fetching ConfigMaps..."
./scripts/get-configmaps.sh --$ENV

echo ""
echo ">>> Step 2: Fetching Secrets..."
./scripts/get-secrets.sh --$ENV

echo ""
echo ">>> Step 3: Fetching Logs..."
./scripts/get-logs.sh "${LOG_ARGS[@]}"

echo ""
echo "========================================================"
echo "All data collection complete!"
echo "========================================================"
