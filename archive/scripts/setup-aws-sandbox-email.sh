#!/usr/bin/env bash
set -euo pipefail

REGION="us-east-2"
DOMAIN="niaxp.com"
FROM_EMAIL="admin@niaxp.com"
TEST_RECIPIENT="jeff@klugs.net"   # while still in sandbox

echo "Using region: $REGION"

# 1. Create / ensure domain identity (Easy DKIM)
echo "[1] Creating/ensuring domain identity: $DOMAIN"
aws sesv2 create-email-identity \
  --region "$REGION" \
  --email-identity "$DOMAIN" \
  --no-tags 2>/dev/null || echo "Domain identity create call returned (already exists or created)."

# 2. Show DNS (DKIM) tokens (add 3 CNAMEs in DNS)
echo "[2] Fetch DKIM tokens (add CNAMEs if not already):"
aws sesv2 get-email-identity \
  --region "$REGION" \
  --email-identity "$DOMAIN" \
  --query 'DkimAttributes.Tokens' \
  --output json

# 3. (Sandbox) Verify sender + test recipient emails (skip after prod access + domain verified)
echo "[3] Verifying individual emails (safe to ignore if already verified)"
for addr in "$FROM_EMAIL" "$TEST_RECIPIENT"; do
  aws ses verify-email-identity --region "$REGION" --email-address "$addr" 2>/dev/null || true
done

# 4. Create configuration set (for events/metrics)
CONFIG_SET="primary"
echo "[4] Creating configuration set: $CONFIG_SET"
aws sesv2 create-configuration-set \
  --region "$REGION" \
  --configuration-set-name "$CONFIG_SET" 2>/dev/null || echo "Config set exists."

# 5. SNS topics for bounces & complaints
echo "[5] Creating SNS topics"
BOUNCE_ARN=$(aws sns create-topic --name ses-bounces --query 'TopicArn' --output text --region "$REGION")
COMPLAINT_ARN=$(aws sns create-topic --name ses-complaints --query 'TopicArn' --output text --region "$REGION")
echo "Bounce topic: $BOUNCE_ARN"
echo "Complaint topic: $COMPLAINT_ARN"

# 6. Attach identity to configuration set
echo "[6] Attaching identity to configuration set"
aws sesv2 put-email-identity-configuration-set-attributes \
  --region "$REGION" \
  --email-identity "$DOMAIN" \
  --configuration-set-name "$CONFIG_SET"

# 7. Disable legacy email forwarding (we’ll consume SNS)
echo "[7] Disabling legacy forwarding"
aws sesv2 put-email-identity-feedback-attributes \
  --region "$REGION" \
  --email-identity "$DOMAIN" \
  --no-email-forwarding-enabled

# 8. Event destination (bounce + complaint -> bounce topic)
# First try create; if it already exists, update instead.
echo "[8] Ensuring event destination (bounce-complaint-sns)"
# Use compact JSON (no literal \n) to avoid AWS CLI parse issues
EVENT_JSON="{\"MatchingEventTypes\":[\"BOUNCE\",\"COMPLAINT\"],\"SnsDestination\":{\"TopicArn\":\"$BOUNCE_ARN\"}}"
if aws sesv2 create-configuration-set-event-destination \
  --region "$REGION" \
  --configuration-set-name "$CONFIG_SET" \
  --event-destination-name "bounce-complaint-sns" \
  --event-destination "$EVENT_JSON" 2>/dev/null; then
  echo "Created event destination bounce-complaint-sns"
else
  echo "Create failed (likely exists); attempting update..."
  aws sesv2 update-configuration-set-event-destination \
    --region "$REGION" \
    --configuration-set-name "$CONFIG_SET" \
    --event-destination-name "bounce-complaint-sns" \
    --event-destination "$EVENT_JSON"
  echo "Updated event destination bounce-complaint-sns"
fi

# Optional: Separate complaints example:
# aws sesv2 create-configuration-set-event-destination \
#   --configuration-set-name "$CONFIG_SET" \
#   --event-destination-name complaint-only \
#   --event-destination "{ \"MatchingEventTypes\": [\"COMPLAINT\"], \"SnsDestination\": { \"TopicArn\": \"$COMPLAINT_ARN\" } }" || \
# aws sesv2 update-configuration-set-event-destination ...

# 9. Status checks
echo "[9] Identity status:"
aws sesv2 get-email-identity --region "$REGION" --email-identity "$DOMAIN" \
  --query '{Verification:VerificationStatus,DKIM:DkimAttributes.Status}'

echo
echo "If Verification != SUCCESS, finish DNS (DKIM CNAMEs) and re-run status later."
echo "Sandbox removal still required to send to unverified recipients."
echo
echo "Test send (only works if both addresses verified while sandbox):"
echo "aws sesv2 send-email --region $REGION --from-email-address $FROM_EMAIL --destination 'ToAddresses=$TEST_RECIPIENT' --content 'Simple={Subject={Data=SES Test},Body={Text={Data=Hello from SES}}}'"