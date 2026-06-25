# Pearl Deployment Setup

This document explains how the pearl environment deployments are configured and how to trigger them.

## Overview

The pearl environment consists of three applications:
- `interface-pearl` - The main Pearl frontend application
- `mesh-pearl` - The GraphQL API service
- `dashboard-pearl` - The admin dashboard

## Deployment Workflows

Three new GitHub Actions workflows have been created to handle pearl deployments:

### 1. deploy-interface-pearl.yml
- **Trigger**: Pushes to `pearl-production` branch with changes to `apps/interface/**`
- **Deploys to**: `interface-pearl` namespace
- **Domain**: `pearlos.org` and `www.pearlos.org`

### 2. deploy-mesh-pearl.yml
- **Trigger**: Pushes to `pearl-production` branch with changes to `apps/mesh/**`
- **Deploys to**: `mesh-pearl` namespace
- **Domain**: `mesh.pearlos.org`

### 3. deploy-dashboard-pearl.yml
- **Trigger**: Pushes to `pearl-production` branch with changes to `apps/dashboard/**`
- **Deploys to**: `dashboard-pearl` namespace
- **Domain**: `dashboard.pearlos.org`

## How to Deploy

### Automatic Deployment
1. Make changes to the desired app(s) in the `pearl-production` branch
2. Push the changes to trigger the appropriate workflow(s)
3. The workflow will:
   - Build a new Docker image
   - Push it to ECR
   - Update the Kubernetes deployment with the new image
   - Wait for the rollout to complete

### Manual Deployment
Each workflow can be triggered manually via the GitHub Actions UI:
1. Go to the Actions tab in the repository
2. Select the desired workflow (e.g., "deploy-interface-pearl")
3. Click "Run workflow"
4. Select the `pearl-production` branch
5. Click "Run workflow"

## Kubernetes Configuration

The pearl environments use the following naming convention:
- **Namespaces**: `{app-name}-pearl` (e.g., `interface-pearl`, `mesh-pearl`, `dashboard-pearl`)
- **Deployments**: `{app-name}-pearl` (e.g., `interface-pearl`, `mesh-pearl`, `dashboard-pearl`)

## Environment Configuration

Each pearl environment uses specific Helm values files:
- Interface: `charts/interface/values-pearl-external-secrets.yaml`
- Mesh: `charts/mesh/values-pearl-external-secrets.yaml`
- Dashboard: `charts/dashboard/values-pearl.yaml`

These configurations include:
- Pearl-specific domain names (pearlos.org)
- External secrets for secure configuration management
- Pearl-specific environment variables

## Branch Strategy

- **`production`** branch → Deploys to production environment (niaxp.io)
- **`staging`** branch → Deploys to staging environment
- **`pearl-production`** branch → Deploys to pearl environment (pearlos.org)

## Monitoring Deployments

You can monitor deployments by:
1. Checking the GitHub Actions tab for workflow status
2. Using kubectl to check deployment status:
   ```bash
   kubectl -n interface-pearl rollout status deployment/interface-pearl
   kubectl -n mesh-pearl rollout status deployment/mesh-pearl
   kubectl -n dashboard-pearl rollout status deployment/dashboard-pearl
   ```

## Troubleshooting

If deployments fail:
1. Check the GitHub Actions logs for build or deployment errors
2. Verify that the pearl-production branch exists and contains the latest changes
3. Ensure the Kubernetes namespaces and deployments exist
4. Check that the necessary secrets and configmaps are configured in the pearl namespaces

