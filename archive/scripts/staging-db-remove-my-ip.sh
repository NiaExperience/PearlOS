#!/bin/bash
# Remove your IP from RDS security group after development work is done
# Good security practice to clean up temporary access rules

set -e

RDS_SG="sg-01982b045c5c21af1"
REGION="us-east-2"

echo "=========================================="
echo "Remove Local IP from RDS Security Group"
echo "=========================================="
echo ""

# Get your current public IP
echo "🔍 Detecting your public IP address..."
MY_IP=$(curl -s https://checkip.amazonaws.com)

if [ -z "$MY_IP" ]; then
    echo "❌ Could not detect your public IP"
    exit 1
fi

echo "✅ Your public IP: $MY_IP"
echo ""

# Check if rule exists
echo "🔍 Checking if your IP has access..."
EXISTING=$(aws ec2 describe-security-groups \
    --group-ids "$RDS_SG" \
    --region "$REGION" \
    --query "SecurityGroups[0].IpPermissions[?ToPort==\`5432\`].IpRanges[?CidrIp==\`$MY_IP/32\`]" \
    --output text 2>/dev/null || echo "")

if [ -z "$EXISTING" ]; then
    echo "ℹ️  Your IP doesn't have access (already removed or never added)"
    exit 0
fi

# Remove the rule
echo "🗑️  Removing your IP from RDS security group..."
echo ""
echo "Command:"
echo "aws ec2 revoke-security-group-ingress \\"
echo "  --group-id $RDS_SG \\"
echo "  --protocol tcp \\"
echo "  --port 5432 \\"
echo "  --cidr $MY_IP/32 \\"
echo "  --region $REGION"
echo ""

read -p "Do you want to proceed? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

aws ec2 revoke-security-group-ingress \
    --group-id "$RDS_SG" \
    --protocol tcp \
    --port 5432 \
    --cidr "$MY_IP/32" \
    --region "$REGION" 2>&1 || {
    echo ""
    echo "❌ Failed to remove rule."
    exit 1
}

echo ""
echo "✅ Successfully removed your IP from RDS security group!"
echo ""
echo "=========================================="
