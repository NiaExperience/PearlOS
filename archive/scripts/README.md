# Archived Scripts

> **Archived:** January 2026  
> **Reason:** These scripts are AWS/K8s dependent and not needed for local development

These scripts were moved from `scripts/` as part of the open-source preparation.
They are kept for reference but are not required for running Nia Universal locally.

## AWS Database Scripts

| Script | Purpose |
|--------|---------|
| `clone-aws-db.ts` | Clone staging database from AWS RDS |
| `clone-aws-prod-db.ts` | Clone production database from AWS RDS |
| `bootstrap-prod-db-from-dev.ts` | Bootstrap production from dev database |
| `delete-tenant-aws.ts` | Delete tenant data from AWS |
| `copy-content-to-aws.ts` | Copy content to AWS environment |
| `copy-local-data-to-aws.sh` | Sync local data to AWS |

## Staging Database Scripts

| Script | Purpose |
|--------|---------|
| `staging-db-add-my-ip.sh` | Add IP to RDS security group |
| `staging-db-remove-my-ip.sh` | Remove IP from RDS security group |
| `staging-db-clone-via-tunnel.sh` | Clone via SSH tunnel |
| `staging-db-test.sh` | Test staging DB connection |
| `staging-db-tunnel.sh` | Open SSH tunnel to staging |

## Kubernetes Scripts

| Script | Purpose |
|--------|---------|
| `get-secrets.sh` | Retrieve K8s secrets |
| `set-kube-secrets.sh` | Set K8s secrets |
| `generate-k8s-secrets.sh` | Generate K8s secrets |
| `set-kube-configmaps.sh` | Set K8s configmaps |
| `get-configmaps.sh` | Get K8s configmaps |
| `setup-cluster.ts` | Setup K8s cluster |
| `validate-helm-charts.sh` | Validate Helm charts |
| `update-k8s-deployments.sh` | Update K8s deployments |

## Log Retrieval Scripts

| Script | Purpose |
|--------|---------|
| `get-logs.sh` | Get K8s pod logs |
| `get-bot-logs.sh` | Get Pipecat bot logs |
| `get-bot-job-logs.sh` | Get bot job logs |
| `get-cloudwatch-logs.sh` | Get AWS CloudWatch logs |
| `get-dashboard-logs.sh` | Get Dashboard logs |
| `get-interface-logs.sh` | Get Interface logs |
| `get-mesh-logs.sh` | Get Mesh logs |
| `get-redis-logs.sh` | Get Redis logs |
| `get-kokoro-logs.sh` | Get Kokoro TTS logs |

## AWS Setup Scripts

| Script | Purpose |
|--------|---------|
| `setup-aws-email.sh` | Setup AWS SES email |
| `setup-aws-sandbox-email.sh` | Setup SES sandbox |
| `add-pipecat-bot-route53.sh` | Add Route53 records |

## Other

| Script | Purpose |
|--------|---------|
| `sync_secrets.py` | Sync secrets between environments |
| `report-sessions.ts` | Generate session reports (CloudWatch) |
| `debug-mesh-k8s.sh` | Debug Mesh in K8s |
| `enable-local-registry.sh` | Enable local Docker registry |
| `kind-with-registry.sh` | Setup Kind with registry |

## Restoring Scripts

If you need these scripts for cloud deployment:

```bash
# Restore a specific script
mv archive/scripts/clone-aws-db.ts scripts/

# Restore all scripts
mv archive/scripts/*.ts archive/scripts/*.sh archive/scripts/*.py scripts/
```

## Local Development

For local development, use:

```bash
# Setup everything
./setup.sh

# Seed database with demo data
npm run pg:seed

# Start the platform
npm run start:all
```

