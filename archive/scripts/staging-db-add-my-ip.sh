#!/bin/bash
# Add your current public IP to RDS security group for local development
# This allows you to run pg:db-clone-aws and other scripts that connect to AWS RDS

set -e

RDS_SG="sg-01982b045c5c21af1"
REGION="us-east-2"

echo "=========================================="
echo "Add Local IP to RDS Security Group"
echo "=========================================="
echo ""

# Get your current public IP
echo "🔍 Detecting your public IP address..."
MY_IP=$(curl -s https://checkip.amazonaws.com)

if [ -z "$MY_IP" ]; then
    echo "❌ Could not detect your public IP"
    echo "Please manually find your IP: curl https://checkip.amazonaws.com"
    exit 1
fi

echo "✅ Your public IP: $MY_IP"
echo ""

# Check if rule already exists
echo "🔍 Checking if your IP already has access..."
EXISTING=$(aws ec2 describe-security-groups \
    --group-ids "$RDS_SG" \
    --region "$REGION" \
    --query "SecurityGroups[0].IpPermissions[?ToPort==\`5432\`].IpRanges[?CidrIp==\`$MY_IP/32\`]" \
    --output text 2>/dev/null || echo "")

if [ -n "$EXISTING" ]; then
    echo "✅ Your IP already has access to RDS"
    echo ""
    echo "Current rules for port 5432:"
    aws ec2 describe-security-groups \
        --group-ids "$RDS_SG" \
        --region "$REGION" \
        --query 'SecurityGroups[0].IpPermissions[?ToPort==`5432`]' \
        --output json | jq -r '.[] | "  Port: \(.FromPort)-\(.ToPort)\n  Sources: \([.IpRanges[].CidrIp // empty, .UserIdGroupPairs[].GroupId // empty] | join(", "))"'
    exit 0
fi

# Add the rule
echo "➕ Adding your IP to RDS security group..."
echo ""
echo "Command:"
echo "aws ec2 authorize-security-group-ingress \\"
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

aws ec2 authorize-security-group-ingress \
    --group-id "$RDS_SG" \
    --protocol tcp \
    --port 5432 \
    --cidr "$MY_IP/32" \
    --region "$REGION" 2>&1 || {
    echo ""
    echo "❌ Failed to add rule. It may already exist or you may lack permissions."
    exit 1
}

echo ""
echo "✅ Successfully added your IP to RDS security group!"
echo ""
echo "You can now run:"
echo "  npm run pg:db-clone-aws"
echo ""
echo "⚠️  Note: If your IP changes (e.g., different network), you'll need to run this script again."
echo ""
echo "=========================================="
