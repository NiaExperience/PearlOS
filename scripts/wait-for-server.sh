#!/bin/bash

URL=${1:-"http://localhost:3000/seatrade-jdx"}
MAX_ATTEMPTS=30
ATTEMPT=1

echo "Waiting for server at $URL to be ready..."

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    echo "Attempt $ATTEMPT/$MAX_ATTEMPTS..."
    
    if curl -s -f -I "$URL" > /dev/null 2>&1; then
        echo "✅ Server is ready!"
        exit 0
    fi
    
    if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
        echo "⏳ Server not ready yet, waiting 5 seconds..."
        sleep 5
    fi
    
    ATTEMPT=$((ATTEMPT + 1))
done

echo "❌ Server failed to start after $MAX_ATTEMPTS attempts"
exit 1 