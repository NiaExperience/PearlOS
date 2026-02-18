#!/bin/bash

# Script to get logs from ephemeral bot jobs (kicked off by bot_operator.py)
# Usage: ./scripts/get-bot-job-logs.sh [options]

set -e

# Configuration
ENV="stg"
NAMESPACE="pipecat-daily-bot-${ENV}"
COUNT=5
OUTPUT_DIR="/private/tmp/kube/logs"
TIMESPAN=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Get logs from ephemeral bot jobs (kicked off by bot_operator.py).

Options:
  -e, --env ENV       Environment (stg, prod, local) [default: stg]
  -n, --count COUNT   Number of recent jobs to fetch [default: 5]
    -t, --timespan SEC  Only include pods started within the last SEC seconds; also scopes log fetch via --since
  -o, --output-dir DIR Directory to save logs [default: /private/tmp/kube/logs]
  -h, --help          Show this help message

Examples:
  $0 -e prod          # Get logs for last 5 jobs in prod
  $0 -e stg -n 10     # Get logs for last 10 jobs in stg
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    key="$1"
    case $key in
        -e|--env)
            ENV="$2"
            shift
            shift
            ;;
        -n|--count)
            COUNT="$2"
            shift
            shift
            ;;
        -t|--timespan)
            TIMESPAN="$2"
            shift
            shift
            ;;
        -o|--output-dir)
            OUTPUT_DIR="$2"
            shift
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Set namespace based on environment
if [ "$ENV" == "prod" ]; then
    NAMESPACE="pipecat-daily-bot-pearl"
elif [ "$ENV" == "local" ]; then
    NAMESPACE="default" # Or whatever local uses
else
    NAMESPACE="pipecat-daily-bot-${ENV}"
fi

# Derive cutoff epoch for time-based filtering (0 disables filter)
CUTOFF_EPOCH=0
if [ -n "$TIMESPAN" ]; then
    CUTOFF_EPOCH=$(date -v-"${TIMESPAN}"S +%s 2>/dev/null || date -d "-${TIMESPAN} seconds" +%s)
fi

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

print_info "Getting last $COUNT job logs from namespace: $NAMESPACE"
if [ "$CUTOFF_EPOCH" -ne 0 ]; then
    print_info "Applying time filter: pods started within the last ${TIMESPAN}s"
fi

# Find pods with label app=pipecat-bot
# Sort by creation timestamp (descending) and take top N
print_info "Discovering job pods..."

PODS_JSON=$(kubectl get pods -n "$NAMESPACE" -l app=pipecat-bot -o json)
PODS=$(echo "$PODS_JSON" | jq -r --arg count "$COUNT" --argjson cutoff "$CUTOFF_EPOCH" '
    (.items // [])
    | map({name: .metadata.name, ts: (.status.startTime // .metadata.creationTimestamp)})
    | map(select($cutoff == 0 or (((.ts // "") | fromdateiso8601?) // 0) >= $cutoff))
    | sort_by(.ts)
    | reverse
    | .[0:(($count | tonumber))]
    | .[].name
')

if [ -z "$PODS" ]; then
    print_warning "No job pods found in namespace $NAMESPACE with label app=pipecat-bot"
    exit 0
fi

# Convert space-separated string to array
POD_ARRAY=($PODS)
TOTAL_PODS=${#POD_ARRAY[@]}

print_success "Found $TOTAL_PODS recent job pods"

LOG_ARGS=()
if [ -n "$TIMESPAN" ]; then
    LOG_ARGS+=("--since=${TIMESPAN}s")
fi

for POD_NAME in "${POD_ARRAY[@]}"; do
    print_info "Fetching logs for pod: $POD_NAME"

    LOG_FILE="${OUTPUT_DIR}/${NAMESPACE}-${POD_NAME}.txt"
    TMP_FILE="${LOG_FILE}.tmp"

    if kubectl logs -n "$NAMESPACE" "$POD_NAME" "${LOG_ARGS[@]}" > "$TMP_FILE" 2>&1; then
        if [ -s "$TMP_FILE" ]; then
            mv "$TMP_FILE" "$LOG_FILE"
            print_success "Saved logs to $LOG_FILE"
        else
            rm -f "$TMP_FILE"
            print_warning "No logs for $POD_NAME in window; skipping file"
        fi
    else
        rm -f "$TMP_FILE"
        print_error "Failed to fetch logs for $POD_NAME"
    fi
done

print_success "Job log collection complete."
