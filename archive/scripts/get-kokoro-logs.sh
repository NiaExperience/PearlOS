#!/bin/bash

# Script to get current logs from the kokoro-tts workspace service container
# Usage: ./scripts/get-kokoro-logs.sh [options]

set -e

# Configuration
ENV="stg"
NAMESPACE="kokoro-tts-${ENV}"
SERVICE_NAME=""  # Will be discovered dynamically
CONTAINER_NAME=""  # Will be discovered dynamically

# Default options
FOLLOW=false
TAIL_LINES=100
SINCE=""
OUTPUT_DIR="/private/tmp/kube/logs"

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

Get current logs from the kokoro-tts workspace service container.

OPTIONS:
    -f, --follow           Follow log output (stream logs)
    -t, --tail LINES       Number of lines to show from the end (default: 100)
    -s, --since TIME       Show logs since timestamp (e.g., '1h', '30m', '2006-01-02T15:04:05Z')
    -e, --env ENV          Environment (stg, prod) (default: stg)
    -n, --namespace NAME   Kubernetes namespace (default: kokoro-tts-{env})
    --service NAME         Service name (optional: will auto-discover if not specified)
    --container NAME       Container name (optional: will auto-discover if not specified)
    --output-dir DIR       Directory to save logs (default: /private/tmp/kube/logs)
    --cloudwatch           Fetch logs from CloudWatch instead of Kubernetes API
    -h, --help             Show this help message

EXAMPLES:
    $0                                    # Auto-discover service/container, get last 100 lines
    $0 --cloudwatch -s 1h                 # Get CloudWatch logs from last hour
    $0 -f                                 # Follow logs in real-time (auto-discovery)
    $0 -t 500                            # Get last 500 lines
    $0 -s 1h                             # Get logs from last hour
    $0 -f -s 10m                         # Follow logs from last 10 minutes
    $0 --namespace my-namespace          # Use different namespace
    $0 --service my-service              # Specify service name
    $0 --container my-container          # Specify container name

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--follow)
            FOLLOW=true
            shift
            ;;
        -t|--tail)
            TAIL_LINES="$2"
            shift 2
            ;;
        -s|--since)
            SINCE="$2"
            shift 2
            ;;
        -e|--env)
            ENV="$2"
            if [ "$ENV" == "prod" ]; then
                NAMESPACE="kokoro-tts-pearl"
            else
                NAMESPACE="kokoro-tts-${ENV}"
            fi
            shift 2
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        --service)
            SERVICE_NAME="$2"
            shift 2
            ;;
        --container)
            CONTAINER_NAME="$2"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --cloudwatch)
            CLOUDWATCH=true
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

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    print_error "kubectl is not installed or not in PATH"
    exit 1
fi

# Check if we can connect to the cluster
if ! kubectl cluster-info &> /dev/null; then
    print_error "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
    exit 1
fi

# Check if namespace exists
if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
    print_error "Namespace '$NAMESPACE' does not exist"
    exit 1
fi

if [ "$CLOUDWATCH" = true ]; then
    print_info "Fetching logs from CloudWatch for namespace: $NAMESPACE"
    
    if [ -z "$SINCE" ]; then
        SINCE="1h"
    fi
    
    # Parse SINCE to calculate START_TIME
    if [[ "$SINCE" =~ ^([0-9]+)([smh])$ ]]; then
        VAL="${BASH_REMATCH[1]}"
        UNIT="${BASH_REMATCH[2]}"
        case "$UNIT" in
            s) DATE_ARG="-v-${VAL}S" ;;
            m) DATE_ARG="-v-${VAL}M" ;;
            h) DATE_ARG="-v-${VAL}H" ;;
        esac
        START_TIME=$(date $DATE_ARG +%s)
    else
        print_warning "Could not parse --since '$SINCE', defaulting to 1h"
        START_TIME=$(date -v-1H +%s)
    fi
    END_TIME=$(date +%s)
    
    OUTPUT_FILE="${OUTPUT_DIR}/${NAMESPACE}-cloudwatch.txt"
    mkdir -p "$OUTPUT_DIR"
    
    ./scripts/get-cloudwatch-logs.sh \
        --namespace "$NAMESPACE" \
        --start-time "$START_TIME" \
        --end-time "$END_TIME" \
        --output-file "$OUTPUT_FILE"
        
    exit $?
fi

print_info "Getting logs from namespace: $NAMESPACE"

# First, let's discover what services and pods are available
print_info "Discovering services and pods in namespace..."
echo -e "${YELLOW}[DEBUG]${NC} Available services:"
kubectl get services -n "$NAMESPACE" -o wide || print_warning "No services found or error getting services"

echo -e "${YELLOW}[DEBUG]${NC} Available pods:"
kubectl get pods -n "$NAMESPACE" -o wide || print_warning "No pods found or error getting pods"

# If SERVICE_NAME is not specified, try to find the first available service or pod
if [ -z "$SERVICE_NAME" ]; then
    print_info "Service name not specified, attempting to discover..."
    
    # Try to find a service first
    DISCOVERED_SERVICE=$(kubectl get services -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | awk '{print $1}')
    if [ -n "$DISCOVERED_SERVICE" ]; then
        SERVICE_NAME="$DISCOVERED_SERVICE"
        print_success "Discovered service: $SERVICE_NAME"
    else
        print_warning "No services found, will search pods directly"
    fi
fi

# Get pod name
print_info "Finding pods..."
if [ -n "$SERVICE_NAME" ]; then
    print_info "Looking for pods with service label: $SERVICE_NAME"
    echo -e "${YELLOW}[DEBUG]${NC} Trying label selector: app=$SERVICE_NAME"
    POD_NAME=$(kubectl get pods -n "$NAMESPACE" -l app="$SERVICE_NAME" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | awk '{print $1}')
    
    if [ -z "$POD_NAME" ]; then
        echo -e "${YELLOW}[DEBUG]${NC} Trying label selector: service=$SERVICE_NAME"
        POD_NAME=$(kubectl get pods -n "$NAMESPACE" -l service="$SERVICE_NAME" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | awk '{print $1}')
    fi
    
    if [ -z "$POD_NAME" ]; then
        echo -e "${YELLOW}[DEBUG]${NC} Trying to match pod name containing: $SERVICE_NAME"
        # Note: jsonpath filter might fail if no items, so we use grep instead for safety
        POD_NAME=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | tr ' ' '\n' | grep "$SERVICE_NAME" | head -n1)
    fi
else
    print_info "No service name available, getting first available pod"
fi

if [ -z "$POD_NAME" ]; then
    print_warning "Could not find pod using service-based selectors, trying to get first available pod..."
    POD_NAME=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | awk '{print $1}')
fi

if [ -z "$POD_NAME" ]; then
    print_error "Could not find any pods in namespace '$NAMESPACE'"
    exit 1
fi

print_success "Found pod: $POD_NAME"

# Now discover containers in the pod
print_info "Discovering containers in pod '$POD_NAME'..."
echo -e "${YELLOW}[DEBUG]${NC} Getting container information..."
CONTAINERS=$(kubectl get pod "$POD_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.containers[*].name}' 2>/dev/null)
echo -e "${YELLOW}[DEBUG]${NC} Available containers: $CONTAINERS"

if [ -z "$CONTAINER_NAME" ]; then
    if [ -n "$CONTAINERS" ]; then
        # If no container specified, we'll get logs from all containers
        CONTAINER_COUNT=$(echo "$CONTAINERS" | wc -w)
        print_success "Found $CONTAINER_COUNT container(s): $CONTAINERS"
        print_info "Will retrieve logs from all containers"
    else
        print_warning "Could not discover container names, will try without specifying container"
    fi
fi

print_info "Configuration summary:"
print_info "  Namespace: $NAMESPACE"
print_info "  Pod: $POD_NAME"
if [ -n "$CONTAINER_NAME" ]; then
    print_info "  Container: $CONTAINER_NAME (single container mode)"
else
    print_info "  Containers: ${CONTAINERS:-"<default>"} (all containers mode)"
fi

# Determine output directory
mkdir -p "$OUTPUT_DIR"

# Function to get logs for a single container
get_container_logs() {
    local container=$1
    local output_file="${OUTPUT_DIR}/${NAMESPACE}-${container}.txt"
    
    # Build kubectl logs command
    local kubectl_cmd="kubectl logs -n $NAMESPACE $POD_NAME -c $container"
    
    # Add tail option
    if [ -n "$TAIL_LINES" ] && [ "$TAIL_LINES" != "0" ]; then
        kubectl_cmd="$kubectl_cmd --tail=$TAIL_LINES"
    fi
    
    # Add since option
    if [ -n "$SINCE" ]; then
        kubectl_cmd="$kubectl_cmd --since=$SINCE"
    fi
    
    # Add follow option
    if [ "$FOLLOW" = true ]; then
        kubectl_cmd="$kubectl_cmd -f"
    fi
    
    print_info "Getting logs for container '$container'..."
    print_info "  Command: $kubectl_cmd"
    print_info "  Output: $output_file"
    
    # Execute the command and save to file
    if eval "$kubectl_cmd" > "$output_file" 2>&1; then
        print_success "Logs for container '$container' saved to: $output_file"
        return 0
    else
        print_error "Failed to retrieve logs for container '$container'"
        return 1
    fi
}

echo "----------------------------------------"

# If specific container is specified, only get logs for that container
if [ -n "$CONTAINER_NAME" ]; then
    if [ "$FOLLOW" = true ]; then
        print_warning "Follow mode with single container - logs will stream to stdout (not saved to file)"
        KUBECTL_CMD="kubectl logs -n $NAMESPACE $POD_NAME -c $CONTAINER_NAME"
        if [ -n "$TAIL_LINES" ] && [ "$TAIL_LINES" != "0" ]; then
            KUBECTL_CMD="$KUBECTL_CMD --tail=$TAIL_LINES"
        fi
        if [ -n "$SINCE" ]; then
            KUBECTL_CMD="$KUBECTL_CMD --since=$SINCE"
        fi
        KUBECTL_CMD="$KUBECTL_CMD -f"
        print_info "Following logs (Press Ctrl+C to stop)..."
        print_info "Executing: $KUBECTL_CMD"
        eval "$KUBECTL_CMD"
    else
        get_container_logs "$CONTAINER_NAME"
    fi
else
    # Get logs from all containers
    if [ "$FOLLOW" = true ]; then
        print_error "Follow mode is not supported when retrieving logs from all containers"
        print_info "Please specify a container with --container <name> to use follow mode"
        exit 1
    fi
    
    if [ -z "$CONTAINERS" ]; then
        print_error "No containers found in pod"
        exit 1
    fi
    
    # Iterate through all containers
    SUCCESS_COUNT=0
    FAIL_COUNT=0
    for container in $CONTAINERS; do
        if get_container_logs "$container"; then
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        else
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
        echo ""
    done
    
    echo "----------------------------------------"
    print_success "Retrieved logs from $SUCCESS_COUNT container(s)"
    if [ $FAIL_COUNT -gt 0 ]; then
        print_warning "Failed to retrieve logs from $FAIL_COUNT container(s)"
        exit 1
    fi
fi
