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

print_status "Setting up External Secrets Operator with AWS Access Keys..."

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

# Get current AWS credentials
print_status "Getting current AWS credentials..."

ACCESS_KEY_ID=$(aws configure get aws_access_key_id)
SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key)

if [[ -z "$ACCESS_KEY_ID" || -z "$SECRET_ACCESS_KEY" ]]; then
    print_error "AWS credentials not found. Please run 'aws configure' first."
    exit 1
fi

print_status "Creating Kubernetes secret with AWS credentials..."

# Create the Kubernetes secret with AWS credentials
kubectl create secret generic aws-secrets-manager-credentials \
  --from-literal=access-key-id="$ACCESS_KEY_ID" \
  --from-literal=secret-access-key="$SECRET_ACCESS_KEY" \
  --namespace external-secrets \
  --dry-run=client -o yaml | kubectl apply -f -

print_status "Applying AWS Secrets Manager setup..."

# Apply the AWS Secrets Manager setup
kubectl apply -f aws-secrets-manager-setup-access-keys.yaml

print_success "AWS access keys setup completed!"

print_status "Next steps:"
echo "1. Create some test secrets in AWS Secrets Manager:"
echo "   aws secretsmanager create-secret --name nia/interface/database-url --secret-string 'postgresql://user:pass@host:5432/db' --region us-west-2"
echo "   aws secretsmanager create-secret --name nia/interface/api-key --secret-string 'your-api-key' --region us-west-2"
echo ""
echo "2. Deploy your application with External Secrets:"
echo "   helm install interface-stg ../interface -f values-staging-external-secrets.yaml"
echo ""
echo "3. Verify the setup:"
echo "   kubectl get externalsecrets -A"
echo "   kubectl get secrets -n interface-stg"

