#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
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

# Configuration
ACCOUNT_ID="577124901432"
REGION="us-east-2"
CLUSTER_NAME="nia"  # Replace with your actual cluster name
ROLE_NAME="external-secrets-operator-role"
POLICY_NAME="external-secrets-policy"

print_status "Setting up AWS resources for External Secrets Operator..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials are not configured. Please run 'aws configure' first."
    exit 1
fi

print_status "Creating IAM policy..."

# Create the IAM policy
aws iam create-policy \
    --policy-name "$POLICY_NAME" \
    --policy-document file://external-secrets-iam-policy.json \
    --description "Policy for External Secrets Operator to access AWS Secrets Manager" \
    || print_warning "Policy may already exist"

print_status "Creating IAM role..."

# Create the IAM role
aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Federated": "arn:aws:iam::'"$ACCOUNT_ID"':oidc-provider/oidc.eks.'"$REGION"'.amazonaws.com/id/*"
                },
                "Action": "sts:AssumeRoleWithWebIdentity",
                "Condition": {
                    "StringEquals": {
                        "oidc.eks.'"$REGION"'.amazonaws.com/id/*:sub": "system:serviceaccount:external-secrets:external-secrets-sa"
                    }
                }
            }
        ]
    }' \
    || print_warning "Role may already exist"

print_status "Attaching policy to role..."

# Attach the policy to the role
aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::$ACCOUNT_ID:policy/$POLICY_NAME"

print_status "Creating OIDC provider for EKS (if it doesn't exist)..."

# Get the OIDC provider ID
OIDC_PROVIDER=$(aws eks describe-cluster --name "$CLUSTER_NAME" --region "$REGION" --query "cluster.identity.oidc.issuer" --output text | cut -d '/' -f 5)

# Create OIDC provider if it doesn't exist
aws iam get-open-id-connect-provider --open-id-connect-provider-arn "arn:aws:iam::$ACCOUNT_ID:oidc-provider/oidc.eks.$REGION.amazonaws.com/id/$OIDC_PROVIDER" &> /dev/null || {
    print_status "Creating OIDC provider..."
    aws iam create-open-id-connect-provider \
        --url "oidc.eks.$REGION.amazonaws.com/id/$OIDC_PROVIDER" \
        --thumbprint-list "9e99a48a9960b14926bb7f3b02e22da2b0ab7280" \
        --client-id-list "sts.amazonaws.com"
}

print_success "AWS resources created successfully!"

print_status "Next steps:"
echo "1. Apply the Kubernetes resources:"
echo "   kubectl apply -f aws-secrets-manager-setup.yaml"
echo ""
echo "2. Create some test secrets in AWS Secrets Manager:"
echo "   aws secretsmanager create-secret --name nia/interface/database-url --secret-string 'postgresql://user:pass@host:5432/db'"
echo "   aws secretsmanager create-secret --name nia/interface/api-key --secret-string 'your-api-key'"
echo ""
echo "3. Deploy your application with External Secrets:"
echo "   helm install interface-stg ../interface -f values-staging-external-secrets.yaml"
