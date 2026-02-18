#!/bin/bash

# Load environment variables from .interface.env
set -a
source .interface.env
set +a

# Build Docker image with build arguments for Next.js public variables
docker build -t nia-interface -f Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL}" \
  --build-arg NEXT_PUBLIC_TWILIO_ACCOUNT_SID="${NEXT_PUBLIC_TWILIO_ACCOUNT_SID}" \
  --build-arg NEXT_PUBLIC_TWILIO_AUTH_TOKEN="${NEXT_PUBLIC_TWILIO_AUTH_TOKEN}" \
  --build-arg NEXT_PUBLIC_DAILY_ROOM_URL="${NEXT_PUBLIC_DAILY_ROOM_URL}" \
  ../../
