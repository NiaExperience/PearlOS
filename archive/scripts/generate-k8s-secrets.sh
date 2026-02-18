#!/bin/bash

# Script to generate Kubernetes secret YAML from .env.local
# Usage: ./scripts/generate-k8s-secrets.sh [namespace] [secret-name] [env-file]

set -e

# Default values
NAMESPACE=${1:-"default"}
SECRET_NAME=${2:-"app-secrets"}
ENV_FILE=${3:-".env.local"}

# Check if .env.local exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found!"
    exit 1
fi

# Function to get value from .env file and base64 encode it
get_and_encode() {
    local key=$1
    local value=$(grep "^${key}=" "$ENV_FILE" | cut -d'=' -f2- | sed 's/^"//' | sed 's/"$//')
    
    if [ -z "$value" ]; then
        echo "Warning: $key not found or empty in $ENV_FILE" >&2
        echo ""
    else
        echo -n "$value" | base64 -w 0
    fi
}

# Extract and encode the required secrets
GOOGLE_INTERFACE_CLIENT_ID_B64=$(get_and_encode "GOOGLE_INTERFACE_CLIENT_ID")
GOOGLE_INTERFACE_CLIENT_SECRET_B64=$(get_and_encode "GOOGLE_INTERFACE_CLIENT_SECRET")
GOOGLE_DASHBOARD_CLIENT_ID_B64=$(get_and_encode "GOOGLE_DASHBOARD_CLIENT_ID")
GOOGLE_DASHBOARD_CLIENT_SECRET_B64=$(get_and_encode "GOOGLE_DASHBOARD_CLIENT_SECRET")
MESH_SHARED_SECRET_B64=$(get_and_encode "MESH_SHARED_SECRET")
TOKEN_ENCRYPTION_KEY_B64=$(get_and_encode "TOKEN_ENCRYPTION_KEY")
NEXTAUTH_INTERFACE_URL_B64=$(get_and_encode "NEXTAUTH_INTERFACE_URL")
NEXTAUTH_DASHBOARD_URL_B64=$(get_and_encode "NEXTAUTH_DASHBOARD_URL")
ANTHROPIC_API_KEY_B64=$(get_and_encode "ANTHROPIC_API_KEY")
OPENAI_API_KEY_B64=$(get_and_encode "OPENAI_API_KEY")
GEMINI_API_KEY_B64=$(get_and_encode "GEMINI_API_KEY")
NEXT_PUBLIC_INTERFACE_BASE_URL_B64=$(get_and_encode "NEXT_PUBLIC_INTERFACE_BASE_URL")

# Generate the YAML
cat << EOF
apiVersion: v1
kind: Secret
metadata:
  name: $SECRET_NAME
  namespace: $NAMESPACE
type: Opaque
data:
  GOOGLE_INTERFACE_CLIENT_ID: $GOOGLE_INTERFACE_CLIENT_ID_B64
  GOOGLE_INTERFACE_CLIENT_SECRET: $GOOGLE_INTERFACE_CLIENT_SECRET_B64
  GOOGLE_DASHBOARD_CLIENT_ID: $GOOGLE_DASHBOARD_CLIENT_ID_B64
  GOOGLE_DASHBOARD_CLIENT_SECRET: $GOOGLE_DASHBOARD_CLIENT_SECRET_B64
  MESH_SHARED_SECRET: $MESH_SHARED_SECRET_B64
  TOKEN_ENCRYPTION_KEY: $TOKEN_ENCRYPTION_KEY_B64
  NEXTAUTH_INTERFACE_URL: $NEXTAUTH_INTERFACE_URL_B64
  NEXTAUTH_DASHBOARD_URL: $NEXTAUTH_DASHBOARD_URL_B64
  ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY_B64
  OPENAI_API_KEY: $OPENAI_API_KEY_B64
  GEMINI_API_KEY: $GEMINI_API_KEY_B64
  NEXT_PUBLIC_INTERFACE_BASE_URL: $NEXT_PUBLIC_INTERFACE_BASE_URL_B64
EOF
