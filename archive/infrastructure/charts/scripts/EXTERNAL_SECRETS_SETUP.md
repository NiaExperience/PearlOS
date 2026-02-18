# External Secrets Operator Setup with AWS Secrets Manager

This guide walks you through setting up External Secrets Operator to securely fetch secrets from AWS Secrets Manager.

## Prerequisites

- Kubernetes cluster (EKS recommended)
- AWS CLI configured with appropriate permissions
- Helm 3.x installed
- kubectl configured to access your cluster

## Step 1: Install External Secrets Operator

```bash
# Add the Helm repository
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

# Install External Secrets Operator
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace
```

## Step 2: Set up AWS Resources

### Option A: Use the automated script (Recommended)

1. Update the cluster name in `setup-aws-secrets.sh`:
   ```bash
   # Edit the script and replace "your-eks-cluster-name" with your actual cluster name
   CLUSTER_NAME="your-actual-cluster-name"
   ```

2. Run the setup script:
   ```bash
   ./setup-aws-secrets.sh
   ```

### Option B: Manual setup

1. Create IAM Policy:
   ```bash
   aws iam create-policy \
     --policy-name external-secrets-policy \
     --policy-document file://external-secrets-iam-policy.json
   ```

2. Create IAM Role:
   ```bash
   aws iam create-role \
     --role-name external-secrets-operator-role \
     --assume-role-policy-document '{
       "Version": "2012-10-17",
       "Statement": [
         {
           "Effect": "Allow",
           "Principal": {
             "Federated": "arn:aws:iam::577124901432:oidc-provider/oidc.eks.us-east-2.amazonaws.com/id/*"
           },
           "Action": "sts:AssumeRoleWithWebIdentity",
           "Condition": {
             "StringEquals": {
               "oidc.eks.us-east-2.amazonaws.com/id/*:sub": "system:serviceaccount:external-secrets:external-secrets-sa"
             }
           }
         }
       ]
     }'
   ```

3. Attach policy to role:
   ```bash
   aws iam attach-role-policy \
     --role-name external-secrets-operator-role \
     --policy-arn arn:aws:iam::577124901432:policy/external-secrets-policy
   ```

## Step 3: Apply Kubernetes Resources

```bash
# Apply the AWS Secrets Manager setup
kubectl apply -f aws-secrets-manager-setup.yaml
```

## Step 4: Create Secrets in AWS Secrets Manager

```bash
# Create secrets for your interface service
aws secretsmanager create-secret \
  --name nia/interface/database-url \
  --secret-string 'postgresql://user:pass@host:5432/db'

aws secretsmanager create-secret \
  --name nia/interface/api-key \
  --secret-string 'your-api-key-here'

aws secretsmanager create-secret \
  --name nia/interface/jwt-secret \
  --secret-string 'your-jwt-secret-here'

# Create secrets for mesh service
aws secretsmanager create-secret \
  --name nia/mesh/database-url \
  --secret-string 'postgresql://user:pass@host:5432/mesh-db'

# Create secrets for dashboard service
aws secretsmanager create-secret \
  --name nia/dashboard/database-url \
  --secret-string 'postgresql://user:pass@host:5432/dashboard-db'
```

## Step 5: Create External Secrets

### Option A: Use Helm chart with External Secrets enabled

```bash
# Deploy interface with external secrets
helm install interface-stg ../interface \
  -f values-staging-external-secrets.yaml
```

### Option B: Create External Secrets manually

```bash
# Apply the example External Secret
kubectl apply -f interface-external-secret-example.yaml
```

## Step 6: Verify the Setup

```bash
# Check External Secrets Operator pods
kubectl get pods -n external-secrets

# Check External Secrets
kubectl get externalsecrets -A

# Check created Kubernetes secrets
kubectl get secrets -n interface-stg

# Check External Secret status
kubectl describe externalsecret interface-stg-external-secret -n interface-stg
```

## Step 7: Deploy Your Application

```bash
# Deploy interface service
helm install interface-stg ../interface \
  -f values-staging-external-secrets.yaml

# Deploy mesh service
helm install mesh-stg ../mesh \
  -f values-staging-external-secrets.yaml

# Deploy dashboard service
helm install dashboard-stg ../dashboard \
  -f values-staging-external-secrets.yaml
```

## Troubleshooting

### Check External Secrets Operator logs

```bash
kubectl logs -n external-secrets deployment/external-secrets
```

### Check External Secret events

```bash
kubectl describe externalsecret interface-stg-external-secret -n interface-stg
```

### Verify AWS permissions

```bash
# Test AWS Secrets Manager access
aws secretsmanager list-secrets --region us-east-2
```

### Common Issues

1. **IAM Role not found**: Make sure the IAM role exists and has the correct trust policy
2. **OIDC provider not configured**: Ensure your EKS cluster has OIDC provider configured
3. **Secrets not syncing**: Check the External Secret status and logs
4. **Permission denied**: Verify the IAM policy allows access to the specific secret paths

## Security Best Practices

1. **Least privilege**: Only grant access to specific secret paths
2. **Secret rotation**: Use AWS Secrets Manager's built-in rotation
3. **Audit logging**: Enable CloudTrail for secret access monitoring
4. **Network security**: Use VPC endpoints for AWS Secrets Manager
5. **Encryption**: Ensure secrets are encrypted at rest and in transit

## Secret Naming Convention

Use a hierarchical naming convention for your secrets:

```
nia/
├── interface/
│   ├── database-url
│   ├── api-key
│   └── jwt-secret
├── mesh/
│   ├── database-url
│   └── api-key
└── dashboard/
    ├── database-url
    └── api-key
```

This makes it easy to manage permissions and organize secrets by service and environment.

