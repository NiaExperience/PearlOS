#!/bin/bash
# Test database credentials from Kubernetes secrets
# Run this script to verify the staging environment database connection

set -e

echo "=================================="
echo "Database Connection Test - Staging"
echo "=================================="
echo ""

# Decode credentials from base64
POSTGRES_USER=$(echo 'cG9zdGdyZXM=' | base64 -d)
POSTGRES_PASSWORD=$(echo 'cWlGbTlrYzZEbmdEYn58Z1J+W0E/b1ZQUl9oVw==' | base64 -d)
POSTGRES_HOST=$(echo 'bmlhLWRldi5jbHVzdGVyLWNqaXl1OGM0NnA1dC51cy1lYXN0LTIucmRzLmFtYXpvbmF3cy5jb20=' | base64 -d)
POSTGRES_DB=$(echo 'bmlhZGV2' | base64 -d)
POSTGRES_PORT=$(echo 'NTQzMg==' | base64 -d)

echo "📍 Connection Details:"
echo "   Host: $POSTGRES_HOST"
echo "   Port: $POSTGRES_PORT"
echo "   Database: $POSTGRES_DB"
echo "   User: $POSTGRES_USER"
echo "   Password: ${POSTGRES_PASSWORD:0:4}...${POSTGRES_PASSWORD: -2}"
echo ""

# Test with psql if available
if command -v psql &> /dev/null; then
    echo "🔍 Testing with psql..."
    PGPASSWORD="$POSTGRES_PASSWORD" psql \
        -h "$POSTGRES_HOST" \
        -p "$POSTGRES_PORT" \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        -c "SELECT version(), current_database(), current_user;" 2>&1 || {
        echo ""
        echo "❌ psql connection failed"
        echo ""
        echo "This is expected if:"
        echo "  - RDS is in a private VPC (requires VPN/bastion)"
        echo "  - Security groups don't allow your IP"
        echo "  - You're testing from outside AWS network"
        echo ""
    }
else
    echo "⚠️  psql not installed, skipping direct test"
fi

# Test with Node.js
if command -v node &> /dev/null; then
    echo ""
    echo "🔍 Testing with Node.js (pg library)..."
    
    # Export for Node script
    export POSTGRES_USER
    export POSTGRES_PASSWORD
    export POSTGRES_HOST
    export POSTGRES_PORT
    export POSTGRES_DB
    
    node "$(dirname "$0")/staging-db-test-connection.js" || {
        echo ""
        echo "❌ Node.js connection test failed"
    }
else
    echo "⚠️  Node.js not installed, skipping Node test"
fi

echo ""
echo "=================================="
echo "Test Complete"
echo "=================================="
