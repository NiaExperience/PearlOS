#!/bin/bash

# Script to fetch logs from CloudWatch Logs Insights
# Usage: ./scripts/get-cloudwatch-logs.sh [options]

set -e

# Default values
LOG_GROUP="/aws/containerinsights/nia/application"
NAMESPACE=""
CONTAINER=""
POD_PREFIX=""
NO_CONTAINER_FILTER=false
START_TIME=""
END_TIME=""
OUTPUT_FILE=""
LIMIT=10000

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse args
while [[ $# -gt 0 ]]; do
    key="$1"
    case $key in
        --namespace) NAMESPACE="$2"; shift; shift ;;
        --container) CONTAINER="$2"; shift; shift ;;
        --pod-prefix) POD_PREFIX="$2"; shift; shift ;;
        --no-container-filter) NO_CONTAINER_FILTER=true; shift ;;
        --start-time) START_TIME="$2"; shift; shift ;;
        --end-time) END_TIME="$2"; shift; shift ;;
        --output-file) OUTPUT_FILE="$2"; shift; shift ;;
        --limit) LIMIT="$2"; shift; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [ -z "$NAMESPACE" ] || [ -z "$START_TIME" ] || [ -z "$END_TIME" ] || [ -z "$OUTPUT_FILE" ]; then
    print_error "Missing required arguments"
    echo "Usage: $0 --namespace NS --start-time EPOCH --end-time EPOCH --output-file FILE [--container NAME]"
    exit 1
fi

# Construct query
# Container Insights stores container logs under fields: kubernetes.namespace_name, kubernetes.container_name, kubernetes.pod_name
QUERY="fields @timestamp, @message | filter kubernetes.namespace_name = \"$NAMESPACE\""
if [ "$NO_CONTAINER_FILTER" = false ] && [ -n "$CONTAINER" ]; then
    QUERY="$QUERY | filter kubernetes.container_name = \"$CONTAINER\""
fi
if [ -n "$POD_PREFIX" ]; then
    # Regex match on pod name prefix to reduce noise when multiple containers share the namespace
    QUERY="$QUERY | filter kubernetes.pod_name like /$POD_PREFIX/"
fi
QUERY="$QUERY | sort @timestamp asc | limit $LIMIT"

print_info "Starting CloudWatch query for namespace '$NAMESPACE'..."

# Start query
QUERY_ID=$(aws logs start-query \
    --log-group-name "$LOG_GROUP" \
    --start-time "$START_TIME" \
    --end-time "$END_TIME" \
    --query-string "$QUERY" \
    --output text \
    --query 'queryId')

if [ -z "$QUERY_ID" ]; then
    print_error "Failed to start CloudWatch query"
    exit 1
fi

# Poll for results
STATUS="Scheduled"
while [ "$STATUS" == "Scheduled" ] || [ "$STATUS" == "Running" ]; do
    sleep 1
    STATUS=$(aws logs get-query-results --query-id "$QUERY_ID" --query 'status' --output text)
done

if [ "$STATUS" != "Complete" ]; then
    print_error "Query failed with status: $STATUS"
    exit 1
fi

# Get results and format
aws logs get-query-results --query-id "$QUERY_ID" > "${OUTPUT_FILE}.json"

# Parse with jq
if [ -s "${OUTPUT_FILE}.json" ]; then
    jq -r '.results[] | "\(.[] | select(.field=="@timestamp").value) \(.[] | select(.field=="@message").value | fromjson | .log // .message // .)"' "${OUTPUT_FILE}.json" > "$OUTPUT_FILE"
    rm "${OUTPUT_FILE}.json"
    
    LINE_COUNT=$(wc -l < "$OUTPUT_FILE" | tr -d ' ')
    if [ "$LINE_COUNT" -eq 0 ]; then
        echo "No events in the given timespan" > "$OUTPUT_FILE"
        print_success "Retrieved 0 log lines from CloudWatch (empty result written)"
    else
        print_success "Retrieved $LINE_COUNT log lines from CloudWatch"
    fi
else
    print_error "No results returned"
    echo "No events in the given timespan" > "$OUTPUT_FILE"
fi
