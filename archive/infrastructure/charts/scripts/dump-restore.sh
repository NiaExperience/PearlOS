#!/bin/bash

set -euo pipefail

REGION=us-east-2
DEV_CLUSTER=nia-dev
PROD_CLUSTER=nia-prod-cluster
DEV_DB=niadev
PROD_DB=niaprod
DEV_USER=postgres
PROD_USER=postgres
JOBS=8

# SSL for all psql tools
export PGSSLMODE=require
export PGOPTIONS='-c statement_timeout=0'

DEV_EP=$(aws rds describe-db-clusters --region "$REGION" \
  --db-cluster-identifier "$DEV_CLUSTER" \
  --query 'DBClusters[0].Endpoint' --output text)

PROD_EP=$(aws rds describe-db-clusters --region "$REGION" \
  --db-cluster-identifier "$PROD_CLUSTER" \
  --query 'DBClusters[0].Endpoint' --output text)

PROD_SECRET_ARN=$(aws rds describe-db-clusters --region "$REGION" \
  --db-cluster-identifier "$PROD_CLUSTER" \
  --query 'DBClusters[0].MasterUserSecret.SecretArn' --output text)

PROD_PASS=$(aws secretsmanager get-secret-value --region "$REGION" \
  --secret-id "$PROD_SECRET_ARN" --query SecretString --output text | jq -r .password)

echo "dev:  $DEV_EP"
echo "prod: $PROD_EP"

DEV_SECRET_ARN=$(aws rds describe-db-clusters --region "$REGION" \
  --db-cluster-identifier "$DEV_CLUSTER" \
  --query 'DBClusters[0].MasterUserSecret.SecretArn' --output text 2>/dev/null || true)

if [ -n "${DEV_SECRET_ARN:-}" ] && [ "$DEV_SECRET_ARN" != "None" ]; then
  DEV_PASS=$(aws secretsmanager get-secret-value --region "$REGION" \
    --secret-id "$DEV_SECRET_ARN" --query SecretString --output text | jq -r .password)
fi

[ -n "${DEV_PASS:-}" ] && export PGPASSWORD="$DEV_PASS" || unset PGPASSWORD

PGPASSWORD="${DEV_PASS:-}" pg_dump -h "$DEV_EP" -U "$DEV_USER" -d "$DEV_DB" \
  -Fc -Z9 --no-owner --no-privileges --blobs -f niadev.dump

PGPASSWORD="$PROD_PASS" pg_restore -h "$PROD_EP" -U "$PROD_USER" -d "$PROD_DB" \
  --no-owner --no-privileges niadev.dump

PGPASSWORD="$PROD_PASS" psql "host=$PROD_EP dbname=$PROD_DB user=$PROD_USER" -c "ANALYZE;"


