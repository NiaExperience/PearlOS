#!/bin/bash

REGION=us-east-2
SRC_CLUSTER=nia-dev
NEW_CLUSTER=nia-prod-cluster
NEW_INSTANCE=nia-prod-instance-1
MASTER_USER=postgres
MIN_ACU=0.5
MAX_ACU=128

# Reuse subnet group & SGs from source
read ENGINE_VERSION SUBNET_GROUP SECURITY_GROUPS <<<$(
  aws rds describe-db-clusters \
    --region "$REGION" --db-cluster-identifier "$SRC_CLUSTER" \
    --query '[DBClusters[0].EngineVersion, DBClusters[0].DBSubnetGroup, join(` `, DBClusters[0].VpcSecurityGroups[].VpcSecurityGroupId)]' \
    --output text
)

# 1) Create the cluster (Serverless v2) with an auto-generated master password
aws rds create-db-cluster \
  --region "$REGION" \
  --db-cluster-identifier "$NEW_CLUSTER" \
  --engine aurora-postgresql \
  --engine-version "$ENGINE_VERSION" \
  --db-subnet-group-name "$SUBNET_GROUP" \
  --vpc-security-group-ids $SECURITY_GROUPS \
  --serverless-v2-scaling-configuration MinCapacity=$MIN_ACU,MaxCapacity=$MAX_ACU \
  --master-username "$MASTER_USER" \
  --manage-master-user-password \
  --deletion-protection

# 2) Add a serverless writer instance
aws rds create-db-instance \
  --region "$REGION" \
  --db-instance-identifier "$NEW_INSTANCE" \
  --db-cluster-identifier "$NEW_CLUSTER" \
  --engine aurora-postgresql \
  --db-instance-class db.serverless

aws rds wait db-instance-available \
  --region "$REGION" \
  --db-instance-identifier "$NEW_INSTANCE"

# 3) Get writer endpoint & secret ARN
WRITER_ENDPOINT=$(aws rds describe-db-clusters --region "$REGION" --db-cluster-identifier "$NEW_CLUSTER" --query 'DBClusters[0].Endpoint' --output text)
MASTER_SECRET_ARN=$(aws rds describe-db-clusters --region "$REGION" --db-cluster-identifier "$NEW_CLUSTER" --query 'DBClusters[0].MasterUserSecret.SecretArn' --output text)
echo "Writer: $WRITER_ENDPOINT"
echo "Secret: $MASTER_SECRET_ARN"

