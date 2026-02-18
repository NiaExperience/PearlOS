#!/bin/bash

# Unified script to get logs from any environment
# Usage: ./scripts/get-logs.sh [--stg|--prod|--local] [--cloudwatch] [-t seconds] [seconds]

ENV="stg"
CLOUDWATCH=false
KUBE=false
TIMESPAN=3600
ORIGINAL_CONTEXT=""
SWITCHED_CONTEXT=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --prod)
            ENV="prod"
            shift
            ;;
        --local)
            ENV="local"
            KUBE=true
            shift
            ;;
        --stg)
            ENV="stg"
            shift
            ;;
        --cloudwatch)
            CLOUDWATCH=true
            shift
            ;;
        --no-cloudwatch)
            CLOUDWATCH=false
            shift
            ;;
        --kube)
            KUBE=true
            shift
            ;;
        --no-kube)
            KUBE=false
            shift
            ;;
        --both)
            CLOUDWATCH=true
            KUBE=true
            shift
            ;;
        -t|--timespan)
            TIMESPAN="$2"
            shift 2
            ;;
        *[0-9]*)
            TIMESPAN="$1"
            shift
            ;;
        *)
            echo "Unknown argument: $1"
            exit 1
            ;;
    esac
done

OUTPUT_ROOT="/tmp/kube/logs/$ENV"
rm -rf "$OUTPUT_ROOT"
mkdir -p "$OUTPUT_ROOT"

# Default output directory (overridden for dual-mode below)
OUTPUT_DIR="$OUTPUT_ROOT"

MINUTES=$((TIMESPAN / 60))
if [ "$MINUTES" -lt 1 ]; then MINUTES=1; fi

# Restore the user's kube context when we exit, if we switched it.
cleanup_context() {
    if [ "$SWITCHED_CONTEXT" = true ] && [ -n "$ORIGINAL_CONTEXT" ]; then
        kubectl config use-context "$ORIGINAL_CONTEXT" >/dev/null 2>&1 || true
    fi
}

trap cleanup_context EXIT

echo "Collecting logs for environment: $ENV"
if [ "$ENV" == "local" ]; then
    echo "Source: Local Kubernetes cluster"
    CLOUDWATCH=false
else
    echo "Source: $ENV environment in AWS EKS"
fi

echo "Timespan: $TIMESPAN seconds ($MINUTES minutes)"
if [ "$CLOUDWATCH" = true ] && [ "$KUBE" = true ]; then
    echo "Mode: both (default)"
    echo "CloudWatch output: $OUTPUT_ROOT/cloudwatch"
    echo "Kubernetes output: $OUTPUT_ROOT/kube"
elif [ "$CLOUDWATCH" = true ]; then
    echo "Mode: cloudwatch only"
    echo "Output directory: $OUTPUT_DIR/cloudwatch"
elif [ "$KUBE" = true ]; then
    echo "Mode: kube only"
    echo "Output directory: $OUTPUT_DIR/kube"
else
    echo "Nothing to fetch: both CloudWatch and kube disabled via flags."
    exit 1
fi

if [ "$ENV" == "local" ]; then
    # Local log collection logic (ported from get-local-logs.sh)
    echo "Fetching local logs..."
    
    # Get all pods across namespaces so we also capture pipecat and supporting services
    pod_rows=$(kubectl get pods -A -o json | jq -r '.items[] | [.metadata.namespace, .metadata.name] | @tsv')

    while IFS=$'\t' read -r namespace pod; do
        if [ -z "$namespace" ] || [ -z "$pod" ]; then
            continue
        fi

        # Get pod JSON
        if ! pod_json=$(kubectl get pod "$pod" -n "$namespace" -o json 2>/dev/null); then
            echo "Pod $pod not found in namespace $namespace, skipping..."
            continue
        fi

        # Get containers
        containers=$(echo "$pod_json" | jq -r '.spec.containers[].name')

        # Ensure folder exists
        mkdir -p "$OUTPUT_DIR/kube"
        
        for container in $containers; do
            if [ "$container" == "auth-proxy" ]; then continue; fi

            echo "Fetching logs for $pod ($container) in $namespace..."
            TMP_FILE=$(mktemp)
            if kubectl logs "$pod" -n "$namespace" -c "$container" --since="${TIMESPAN}s" > "$TMP_FILE" 2>/dev/null; then
                if [ -s "$TMP_FILE" ]; then
                    mv "$TMP_FILE" "$OUTPUT_DIR/kube/${namespace}-${pod}-${container}.txt"
                else
                    rm -f "$TMP_FILE"
                fi
            else
                rm -f "$TMP_FILE"
            fi
        done
    done <<< "$pod_rows"

else
    # Staging or Production logic

    # For staging/prod, temporarily switch kube context to the shared EKS cluster
    # so downstream scripts pull the right logs. Always restore the previous
    # context on exit.
    if [ "$ENV" = "stg" ] || [ "$ENV" = "prod" ]; then
        ORIGINAL_CONTEXT=$(kubectl config current-context 2>/dev/null || true)
        TARGET_CONTEXT="arn:aws:eks:us-east-2:577124901432:cluster/nia"
        if kubectl config use-context "$TARGET_CONTEXT" >/dev/null 2>&1; then
            SWITCHED_CONTEXT=true
        else
            echo "Warning: failed to switch kubectl context to $TARGET_CONTEXT. Continuing with current context: ${ORIGINAL_CONTEXT:-unknown}" >&2
        fi
    fi

    run_fetch() {
        local mode="$1"      # "cloudwatch" or "kube"
        local out_dir="$2"
        local args=""

        mkdir -p "$out_dir"

        if [ "$mode" = "cloudwatch" ]; then
            echo "Using CloudWatch..."
            args="--cloudwatch -s ${TIMESPAN}s -e $ENV --output-dir $out_dir"
        else
            echo "Using Kubernetes API..."
            args="-t $TIMESPAN -e $ENV --output-dir $out_dir"
        fi

        echo ""
        echo "Redis..."
        ./scripts/get-redis-logs.sh $args

        echo ""
        echo "Interface..."
        ./scripts/get-interface-logs.sh $args

        echo ""
        echo "Bot (Gateway)..."
        ./scripts/get-bot-logs.sh $args --service gateway

        echo "Bot (Operator)..."
        ./scripts/get-bot-logs.sh $args --service operator

        echo "Bot (Warm Pool)..."
        ./scripts/get-bot-logs.sh $args --service warm-pool

        if [ "$mode" = "cloudwatch" ]; then
            echo "Bot (Warm Pool via CloudWatch direct)..."
            local ns="pipecat-daily-bot-$ENV"
            local env_label="$ENV"
            if [ "$ENV" = "prod" ]; then
                ns="pipecat-daily-bot-pearl"
                env_label="pearl"
            fi
            local start_ts end_ts
            start_ts=$(date -v-${TIMESPAN}S +%s)
            end_ts=$(date +%s)
            ./scripts/get-cloudwatch-logs.sh \
                --namespace "$ns" \
                --pod-prefix warm-pool \
                --no-container-filter \
                --start-time "$start_ts" \
                --end-time "$end_ts" \
                --output-file "$out_dir/pipecat-daily-bot-${env_label}-runner-cloudwatch.txt"
        fi

        if [ "$mode" = "cloudwatch" ]; then
            echo "Bot (Jobs via CloudWatch)..."
            # Jobs run as pod container "bot" with names like bot-<uuid> in the pipecat namespace
            local ns="pipecat-daily-bot-$ENV"
            local env_label="$ENV"
            if [ "$ENV" = "prod" ]; then
                ns="pipecat-daily-bot-pearl"
                env_label="pearl"
            fi
            local start_ts end_ts
            start_ts=$(date -v-${TIMESPAN}S +%s)
            end_ts=$(date +%s)
            ./scripts/get-cloudwatch-logs.sh \
                --namespace "$ns" \
                --container bot \
                --pod-prefix bot- \
                --start-time "$start_ts" \
                --end-time "$end_ts" \
                --output-file "$out_dir/pipecat-daily-bot-${env_label}-jobs-cloudwatch.txt"
        fi

        if [ "$mode" = "kube" ]; then
            echo "Bot (Jobs)..."
            ./scripts/get-bot-job-logs.sh -e $ENV -n 5 -t $TIMESPAN --output-dir "$out_dir"
        fi

        echo ""
        echo "Mesh..."
        ./scripts/get-mesh-logs.sh $args

        echo ""
        echo "Dashboard..."
        ./scripts/get-dashboard-logs.sh $args

        echo ""
        echo "Kokoro TTS (Always Staging)..."
        # Kokoro is only in staging, so always pull from stg
        if [ "$mode" = "cloudwatch" ]; then
            KOKORO_ARGS="--cloudwatch -s ${TIMESPAN}s -e stg --output-dir $out_dir"
        else
            KOKORO_ARGS="-t $TIMESPAN -e stg --output-dir $out_dir"
        fi
        ./scripts/get-kokoro-logs.sh $KOKORO_ARGS
    }

    CW_OUT="$OUTPUT_ROOT/cloudwatch"
    KUBE_OUT="$OUTPUT_ROOT/kube"

    if [ "$CLOUDWATCH" = true ] && [ "$KUBE" = true ]; then
        run_fetch "cloudwatch" "$CW_OUT"
        echo ""
        run_fetch "kube" "$KUBE_OUT"
    elif [ "$CLOUDWATCH" = true ]; then
        run_fetch "cloudwatch" "$CW_OUT"
    elif [ "$KUBE" = true ]; then
        run_fetch "kube" "$KUBE_OUT"
    fi
fi

echo ""
echo "=========================================="
echo "Logs saved to $OUTPUT_ROOT:"
find "$OUTPUT_ROOT" -type f -name "*.txt" -maxdepth 2 -print 2>/dev/null || echo "No log files found"

# Generate session report
echo ""
echo "=========================================="
echo "Generating session report for $ENV..."
if [ "$CLOUDWATCH" = true ] && [ "$KUBE" = true ]; then
    SOURCE_ARG="both"
elif [ "$CLOUDWATCH" = true ]; then
    SOURCE_ARG="cloudwatch"
else
    SOURCE_ARG="kube"
fi

if [ "$ENV" = "local" ]; then
    npm run report:local --silent 2>/dev/null || npx ts-node --project ./tsconfig.json ./scripts/report-sessions.ts --env local --source kube --root /private/tmp/kube/logs
else
    npx ts-node --project ./tsconfig.json ./scripts/report-sessions.ts --env "$ENV" --source "$SOURCE_ARG"
fi

echo ""
echo "Report files:"
echo "  HTML: /tmp/report-${ENV}.html"
echo "  Text: /tmp/report-${ENV}.txt"
