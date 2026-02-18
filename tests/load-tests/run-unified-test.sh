#!/bin/bash
# Script to run the unified JMeter load test

# Default settings
NUM_THREADS=${1:-200}
DURATION=${2:-30} # in seconds
RAMP_UP=${3:-10} # in seconds
LOOP_COUNT=${4:-25000}
LOOP_CONTINUE_FOREVER=${5:-false}

# Set up working directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if jmeter is installed
if ! command -v jmeter &> /dev/null; then
    echo "JMeter is not installed. Please install JMeter and try again."
    exit 1
fi

# Create results directory if it doesn't exist
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"

# Set timestamp for results
TIMESTAMP=$(date +"%Y-%m-%d-%H-%M-%S")
RESULT_FILE="$RESULTS_DIR/load-test-unified-$TIMESTAMP.jtl"
REPORT_DIR="$RESULTS_DIR/report-unified-$TIMESTAMP"

echo "Starting JMeter Unified Load Test with:"
echo "  - $NUM_THREADS concurrent users"
echo "  - $DURATION seconds duration"
echo "  - $RAMP_UP seconds ramp-up time"
echo "  - $LOOP_COUNT loops per user"
echo "  - continue forever? $LOOP_CONTINUE_FOREVER"
echo "  - Using tenant ID from tenant-id.csv"

# Get the tenant ID from the csv file
TENANT_ID=$(cat tenant-id.csv)
echo "Using tenant ID: $TENANT_ID"

# Run JMeter in non-GUI mode
jmeter -n \
    -t "$SCRIPT_DIR/jmeter/load-test-unified.jmx" \
    -l "$RESULT_FILE" \
    -e -o "$REPORT_DIR" \
    -JTENANT_ID="$TENANT_ID" \
    -JNUM_THREADS="$NUM_THREADS" \
    -JDURATION="$DURATION" \
    -JRAMP_UP="$RAMP_UP" \
    -JLOOP_COUNT="$LOOP_COUNT" \
    -JLOOP_CONTINUE_FOREVER="$LOOP_CONTINUE_FOREVER"

# Check if test ran successfully
if [ $? -eq 0 ]; then
    echo "JMeter test completed successfully."
    echo "Results saved to: $RESULT_FILE"
    echo "HTML report available at: $REPORT_DIR/index.html"
else
    echo "JMeter test failed."
    exit 1
fi
