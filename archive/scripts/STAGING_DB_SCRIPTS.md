# Staging Database Scripts

A collection of scripts for managing connections to the AWS RDS staging database.

## Quick Reference

### Test Connection
```bash
npm run pg:db-test
# or
./scripts/staging-db-test.sh
```
Tests database connectivity from your local machine to AWS RDS staging.

### Clone Database (Direct)
```bash
npm run pg:db-clone-aws
```
Clones the staging database to your local Postgres. **Requires RDS to be publicly accessible.**

### Clone Database (via Tunnel)
```bash
npm run pg:db-clone-aws:tunnel
# or
./scripts/staging-db-clone-via-tunnel.sh
```
Clones the staging database through a Kubernetes proxy tunnel. Works even when RDS is private.

### Manage IP Access
```bash
# Add your current IP to RDS security group
npm run pg:db-add-my-ip
# or
./scripts/staging-db-add-my-ip.sh

# Remove your IP when done (optional, for security)
npm run pg:db-remove-my-ip
# or
./scripts/staging-db-remove-my-ip.sh
```

## Files

### Shell Scripts
- **`staging-db-test.sh`** - Test database connectivity and display connection info
- **`staging-db-clone-via-tunnel.sh`** - Clone database via Kubernetes tunnel (works when RDS is private)
- **`staging-db-tunnel.sh`** - Create Kubernetes port-forward tunnel to RDS
- **`staging-db-add-my-ip.sh`** - Add your public IP to RDS security group
- **`staging-db-remove-my-ip.sh`** - Remove your public IP from RDS security group

### Node.js Scripts
- **`staging-db-test-connection.js`** - Connection test implementation using pg library

## How the Tunnel Works

When RDS is private (not publicly accessible):

1. Creates a temporary `socat` proxy pod in the `mesh-stg` Kubernetes namespace
2. The proxy pod can reach RDS because it's in the same VPC
3. Uses `kubectl port-forward` to expose the proxy pod on your local machine
4. Your scripts connect to `localhost:15432`, which forwards to RDS

The proxy pod persists between runs for faster subsequent connections.

## Security Notes

### Public RDS
- **Current Status**: Staging RDS is publicly accessible
- **Protection**: Security group restricts access to specific IPs only
- **Use Case**: Convenient for dev team; acceptable for staging environment

### Private RDS (Alternative)
If RDS is made private:
- Use `npm run pg:db-clone-aws:tunnel` instead of direct clone
- No security group IP management needed
- Slightly slower initial connection (creates proxy pod)

## Troubleshooting

### Connection Timeout
- Check if your IP is in the security group: `npm run pg:db-add-my-ip`
- Check if RDS is publicly accessible (if not, use tunnel method)
- Verify you're authenticated with AWS: `aws sso login --sso-session niaxp`

### Tunnel Issues
- Ensure kubectl is configured: `kubectl get pods -n mesh-stg`
- Check proxy pod status: `kubectl get pod rds-proxy-temp -n mesh-stg`
- View tunnel logs: `cat /tmp/rds-tunnel.log`
- Stop tunnel: `pkill -f 'kubectl port-forward'`
- Remove proxy pod: `kubectl delete pod rds-proxy-temp -n mesh-stg`

### Port Already in Use
If port 15432 is already in use by another process:
```bash
# Find the process
lsof -i :15432

# Kill the tunnel
pkill -f 'kubectl port-forward'
```

## Environment Variables

These scripts use credentials from `.env.local`:

```bash
# AWS Staging Database (source)
AWS_POSTGRES_HOST=nia-dev-instance-1.cjiyu8c46p5t.us-east-2.rds.amazonaws.com
AWS_POSTGRES_PORT=5432
AWS_POSTGRES_DB=niadev
AWS_POSTGRES_USER=postgres
AWS_POSTGRES_PASSWORD=<from-secret>

# Local Database (target)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=testdb
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<local-password>
```

When using the tunnel, the clone script automatically overrides:
- `AWS_POSTGRES_HOST=localhost`
- `AWS_POSTGRES_PORT=15432`

## Production Bootstrap

Looking to seed production with development data? Refer to `scripts/PROD_DB_BOOTSTRAP.md` for the guarded bootstrap workflow (`npm run pg:db-bootstrap-prod`).
